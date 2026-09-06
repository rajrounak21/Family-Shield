import json
import logging
from pywebpush import webpush, WebPushException
from core.config import settings
from services.notification_service import get_subscriptions_for_family

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = getattr(settings, "vapid_private_key", "")
VAPID_CLAIMS = {"sub": "mailto:admin@familyshield.app"}


def send_push_notification(subscription_info: dict, title: str, body: str, url: str = "/"):
    """Send a single push notification to a browser subscription."""
    if not VAPID_PRIVATE_KEY:
        logger.warning("VAPID_PRIVATE_KEY not configured, skipping push")
        return False

    try:
        webpush(
            subscription_info={
                "endpoint": subscription_info["endpoint"],
                "keys": subscription_info.get("keys", {}),
            },
            data=json.dumps({
                "title": title,
                "body": body,
                "url": url,
            }),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS,
        )
        return True
    except WebPushException as e:
        logger.error(f"Push failed for {subscription_info.get('endpoint', '?')}: {e}")
        if "410" in str(e) or "404" in str(e):
            from services.notification_service import remove_push_subscription
            remove_push_subscription(subscription_info["endpoint"])
        return False


def send_push_to_offline(family_id: str, sender_id: str, family_name: str, sender_name: str, preview: str):
    """Send push notifications to offline family members."""
    from routers.chat import manager

    subscriptions = get_subscriptions_for_family(family_id, exclude_user_id=sender_id)
    if not subscriptions:
        return

    online_users = set()
    if family_id in manager.active_connections:
        online_users = set(manager.active_connections[family_id].keys())

    for sub in subscriptions:
        uid = sub.get("user_id", "")
        if uid in online_users:
            continue

        send_push_notification(
            subscription_info={"endpoint": sub["endpoint"], "keys": sub.get("keys", {})},
            title=family_name,
            body=f"{sender_name}: {preview}",
            url=f"/chat/index.html?family_id={family_id}",
        )
