from pathlib import Path
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from core.config import settings
from routers.auth import router as auth_router
from routers.family import router as family_router
from routers.chat import router as chat_router
from routers.notification import router as notification_router
from routers.ai import router as ai_router
from routers.share import router as share_router
from routers.case import router as case_router
from routers.review import router as review_router

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(
    title="FamilyShield API",
    description="API for family shield",
    version="1.0.0",
)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    same_site="lax",
    https_only=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "ws://localhost:8000",
        "ws://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(family_router)
app.include_router(chat_router)
app.include_router(notification_router)
app.include_router(ai_router)
app.include_router(share_router)
app.include_router(case_router)
app.include_router(review_router)


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    response: Response = await call_next(request)
    path = request.url.path
    if path.endswith((".js", ".css")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# Mount frontend as static files
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
