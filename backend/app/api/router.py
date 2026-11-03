from fastapi import APIRouter

from app.api import auth, dashboard, exercises, nodes, plans, subjects

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(subjects.router)
api_router.include_router(plans.router)
api_router.include_router(nodes.router)
api_router.include_router(exercises.router)
