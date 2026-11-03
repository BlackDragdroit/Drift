from fastapi import APIRouter

from app.api import (
    auth,
    dashboard,
    documents,
    exercises,
    files,
    jobs,
    nodes,
    plans,
    practice,
    search,
    sessions,
    subjects,
)

api_router = APIRouter(prefix="/api")
for module in (
    auth,
    dashboard,
    subjects,
    plans,
    nodes,
    exercises,
    documents,
    jobs,
    practice,
    sessions,
    search,
    files,
):
    api_router.include_router(module.router)
