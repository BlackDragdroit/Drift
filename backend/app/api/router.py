from fastapi import APIRouter

from app.api import auth, dashboard, documents, exercises, files, jobs, nodes, plans, subjects

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(subjects.router)
api_router.include_router(plans.router)
api_router.include_router(nodes.router)
api_router.include_router(exercises.router)
api_router.include_router(documents.router)
api_router.include_router(jobs.router)
api_router.include_router(files.router)
