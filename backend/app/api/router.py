from fastapi import APIRouter

from app.api import (
    auth,
    dashboard,
    documents,
    exercises,
    files,
    flashcards,
    formulas,
    jobs,
    nodes,
    plans,
    practice,
    search,
    sessions,
    subjects,
    system,
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
    flashcards,
    formulas,
    system,
    files,
):
    api_router.include_router(module.router)
