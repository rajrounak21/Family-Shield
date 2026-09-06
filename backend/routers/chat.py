from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from bson import ObjectId
from schemas.chat import (
    EditMessageRequest,
    ReactionRequest,
    SeenRequest,
    SendMessageRequest,
    ChatHistoryResponse,
    UploadResponse,
)
from services.chat_service import (
    delete_message,
    edit_message,
    mark_messages_seen,
    send_message,
    get_chat_history,
    search_messages,
    store_image,
    get_image,
    is_family_member,
    get_family_members,
    toggle_reaction,
)
from services.notification_service import create_message_notifications
from services.push_service import send_push_to_offline
from routers.auth import get_current_user
from core.security import decode_access_token
from core.database import families_collection
from io import BytesIO
import logging

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/chat",
    tags=["Chat"]
)


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, family_id: str, user_id: str, user_name: str):
        if family_id not in self.active_connections:
            self.active_connections[family_id] = {}
        self.active_connections[family_id][user_id] = {
            "ws": websocket,
            "name": user_name,
        }

    def disconnect(self, family_id: str, user_id: str):
        if family_id in self.active_connections:
            self.active_connections[family_id].pop(user_id, None)
            if not self.active_connections[family_id]:
                del self.active_connections[family_id]

    async def broadcast(self, family_id: str, message: dict, exclude_user: str = None):
        if family_id not in self.active_connections:
            logger.debug("No connections for family %s", family_id)
            return
        conns = list(self.active_connections[family_id].items())
        logger.debug("Broadcasting to %d connections", len(conns))
        for uid, conn in conns:
            if uid != exclude_user:
                try:
                    await conn["ws"].send_json(message)
                except Exception as e:
                    logger.warning("Failed to send to %s: %s", uid, e)

    async def broadcast_online_status(self, family_id: str):
        if family_id not in self.active_connections:
            return
        online_users = [
            {"user_id": uid, "name": conn["name"]}
            for uid, conn in self.active_connections[family_id].items()
        ]
        for uid, conn in list(self.active_connections[family_id].items()):
            try:
                await conn["ws"].send_json({
                    "type": "online_users",
                    "users": online_users,
                })
            except Exception:
                pass

    def get_online_users(self, family_id: str) -> list:
        if family_id not in self.active_connections:
            return []
        return [
            {"user_id": uid, "name": conn["name"]}
            for uid, conn in self.active_connections[family_id].items()
        ]


manager = ConnectionManager()


@router.get("/{family_id}/messages", response_model=ChatHistoryResponse)
def get_messages(
    family_id: str,
    limit: int = 50,
    before: str = None,
    current_user=Depends(get_current_user),
):
    if not is_family_member(family_id, str(current_user["_id"])):
        raise HTTPException(status_code=403, detail="Not a member of this family")

    return get_chat_history(family_id, limit, before)


def _require_member(family_id: str, user_id: str):
    if not is_family_member(family_id, user_id):
        raise HTTPException(status_code=403, detail="Not a member of this family")


def _mutation_error(e: ValueError) -> HTTPException:
    msg = str(e)
    if "not found" in msg.lower():
        return HTTPException(status_code=404, detail=msg)
    if "own messages" in msg:
        return HTTPException(status_code=403, detail=msg)
    return HTTPException(status_code=400, detail=msg)


@router.patch("/{family_id}/messages/{message_id}")
async def edit_chat_message(
    family_id: str,
    message_id: str,
    data: EditMessageRequest,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    _require_member(family_id, user_id)
    try:
        msg = edit_message(family_id, message_id, user_id, data.content)
    except ValueError as e:
        raise _mutation_error(e)
    await manager.broadcast(family_id, {"type": "message_edited", "message": msg})
    return msg


@router.delete("/{family_id}/messages/{message_id}")
async def delete_chat_message(
    family_id: str,
    message_id: str,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    _require_member(family_id, user_id)
    try:
        msg = delete_message(family_id, message_id, user_id)
    except ValueError as e:
        raise _mutation_error(e)
    await manager.broadcast(family_id, {"type": "message_deleted", "message": msg})
    return msg


@router.post("/{family_id}/messages/{message_id}/reactions")
async def react_chat_message(
    family_id: str,
    message_id: str,
    data: ReactionRequest,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    _require_member(family_id, user_id)
    try:
        msg = toggle_reaction(family_id, message_id, user_id, data.emoji)
    except ValueError as e:
        raise _mutation_error(e)
    await manager.broadcast(family_id, {"type": "reaction_updated", "message": msg})
    return msg


@router.post("/{family_id}/seen")
async def mark_seen(
    family_id: str,
    data: SeenRequest,
    current_user=Depends(get_current_user),
):
    """Batch-mark messages as seen by the caller. No-op on empty input."""
    user_id = str(current_user["_id"])
    _require_member(family_id, user_id)
    touched = mark_messages_seen(family_id, user_id, data.message_ids)
    if touched:
        await manager.broadcast(family_id, {"type": "messages_seen", "messages": touched})
    return {"messages": touched}


@router.get("/{family_id}/search")
def search_chat_messages(
    family_id: str,
    q: str,
    current_user=Depends(get_current_user),
):
    if not is_family_member(family_id, str(current_user["_id"])):
        raise HTTPException(status_code=403, detail="Not a member of this family")

    if not q.strip():
        return {"messages": []}

    messages = search_messages(family_id, q.strip())
    return {"messages": messages}


@router.post("/{family_id}/upload", response_model=UploadResponse)
async def upload_image(
    family_id: str,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    if not is_family_member(family_id, str(current_user["_id"])):
        raise HTTPException(status_code=403, detail="Not a member of this family")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    file_data = await file.read()

    if len(file_data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be less than 10MB")

    image_id = store_image(file_data, file.filename, file.content_type)

    return UploadResponse(
        image_id=image_id,
        message="Image uploaded successfully",
    )


@router.get("/images/{image_id}")
def serve_image(image_id: str):
    try:
        image = get_image(image_id)
        return StreamingResponse(
            BytesIO(image.read()),
            media_type=image.content_type or "image/png",
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Image not found")


@router.websocket("/ws/{family_id}")
async def websocket_chat(websocket: WebSocket, family_id: str):
    await websocket.accept()

    try:
        auth_msg = await websocket.receive_json()

        if auth_msg.get("type") != "auth" or not auth_msg.get("token"):
            await websocket.send_json({"type": "error", "detail": "Authentication required"})
            await websocket.close(code=4001)
            return

        try:
            payload = decode_access_token(auth_msg["token"])
            user_id = payload.get("sub")
        except Exception as e:
            logger.warning("WS token decode error: %s", e)
            await websocket.send_json({"type": "error", "detail": "Invalid token"})
            await websocket.close(code=4001)
            return

        from services.auth_service import get_user_by_id
        user = get_user_by_id(user_id)

        if not user:
            logger.warning("WS user not found: %s", user_id)
            await websocket.send_json({"type": "error", "detail": "User not found"})
            await websocket.close(code=4001)
            return

        is_member = is_family_member(family_id, user_id)

        if not is_member:
            await websocket.send_json({"type": "error", "detail": "Not a member of this family"})
            await websocket.close(code=4003)
            return

        user_name = user.get("name", "Unknown")

        await manager.connect(websocket, family_id, user_id, user_name)

        await websocket.send_json({
            "type": "connected",
            "user_id": user_id,
            "user_name": user_name,
            "online_users": manager.get_online_users(family_id),
        })

        await manager.broadcast_online_status(family_id)

        try:
            while True:
                data = await websocket.receive_json()

                if data["type"] == "message":
                    msg_type = data.get("msg_type", "text")
                    content = data.get("content", "")
                    image_id = data.get("image_id")
                    reply_to = data.get("reply_to")

                    try:
                        msg = send_message(
                            family_id=family_id,
                            sender_id=user_id,
                            sender_name=user_name,
                            content=content,
                            msg_type=msg_type,
                            image_id=image_id,
                            reply_to=reply_to,
                        )
                    except ValueError as e:
                        await websocket.send_json({"type": "error", "detail": str(e)})
                        continue

                    await manager.broadcast(family_id, msg)

                    if msg_type in ("text", "image"):
                        preview = content[:80] if content else "Image"
                        try:
                            fam = families_collection.find_one({"_id": ObjectId(family_id)})
                            family_name = fam["name"] if fam else "Family"
                        except Exception:
                            family_name = "Family"
                        create_message_notifications(
                            family_id=family_id,
                            sender_id=user_id,
                            sender_name=user_name,
                            family_name=family_name,
                            message_preview=preview,
                        )
                        send_push_to_offline(
                            family_id=family_id,
                            sender_id=user_id,
                            family_name=family_name,
                            sender_name=user_name,
                            preview=preview,
                        )

                elif data["type"] == "typing":
                    await manager.broadcast(family_id, {
                        "type": "typing",
                        "user_id": user_id,
                        "user_name": user_name,
                    }, exclude_user=user_id)

        except WebSocketDisconnect:
            logger.debug("WS user %s disconnected", user_name)
            manager.disconnect(family_id, user_id)
            await manager.broadcast_online_status(family_id)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("WS error: %s", e)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
