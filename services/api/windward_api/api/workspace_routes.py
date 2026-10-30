"""`/api/v1` workspace endpoints: saved queries, notebooks, Python cells, uploads."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field

from ..errors import InvalidRequestError, WindwardError
from ..kernel import KernelManager
from ..query.uploads import MAX_BYTES, UploadService
from ..store import Store

router = APIRouter(prefix="/api/v1", tags=["workspace"])


class NotFoundError(WindwardError):
    code = "NOT_FOUND"
    status_code = 404


def get_store(request: Request) -> Store:
    return request.app.state.store


def get_kernels(request: Request) -> KernelManager:
    return request.app.state.kernels


def get_uploads(request: Request) -> UploadService:
    return request.app.state.uploads


StoreDep = Annotated[Store, Depends(get_store)]
KernelDep = Annotated[KernelManager, Depends(get_kernels)]
UploadDep = Annotated[UploadService, Depends(get_uploads)]


class SavedQueryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sql: str = Field(min_length=1)
    id: str | None = None


class NotebookIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    cells: list[dict[str, Any]] = Field(default_factory=list)


class CodeIn(BaseModel):
    code: str


# -- saved queries ---------------------------------------------------------
@router.get("/saved-queries")
async def list_saved_queries(store: StoreDep) -> list[dict[str, Any]]:
    return store.list_queries()


@router.post("/saved-queries", status_code=status.HTTP_201_CREATED)
async def save_query(payload: SavedQueryIn, store: StoreDep) -> dict[str, Any]:
    return store.save_query(payload.name, payload.sql, payload.id)


@router.delete("/saved-queries/{query_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_query(query_id: str, store: StoreDep) -> None:
    if not store.delete_query(query_id):
        raise NotFoundError("No saved query with that id.")


# -- notebooks -------------------------------------------------------------
@router.get("/notebooks")
async def list_notebooks(store: StoreDep) -> list[dict[str, Any]]:
    return store.list_notebooks()


@router.post("/notebooks", status_code=status.HTTP_201_CREATED)
async def create_notebook(payload: NotebookIn, store: StoreDep) -> dict[str, Any]:
    return store.create_notebook(payload.name, payload.cells)


@router.get("/notebooks/{notebook_id}")
async def get_notebook(notebook_id: str, store: StoreDep) -> dict[str, Any]:
    notebook = store.get_notebook(notebook_id)
    if notebook is None:
        raise NotFoundError("No notebook with that id.")
    return notebook


@router.put("/notebooks/{notebook_id}")
async def update_notebook(notebook_id: str, payload: NotebookIn, store: StoreDep) -> dict[str, Any]:
    notebook = store.update_notebook(notebook_id, payload.name, payload.cells)
    if notebook is None:
        raise NotFoundError("No notebook with that id.")
    return notebook


@router.delete("/notebooks/{notebook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notebook(notebook_id: str, store: StoreDep, kernels: KernelDep) -> None:
    if not store.delete_notebook(notebook_id):
        raise NotFoundError("No notebook with that id.")
    await kernels.reset(notebook_id)


@router.post("/notebooks/{notebook_id}/python")
async def run_python(notebook_id: str, payload: CodeIn, kernels: KernelDep) -> dict[str, Any]:
    """Run one Python cell in the notebook's kernel; variables persist between calls."""
    if not payload.code.strip():
        raise InvalidRequestError("`code` must not be empty.")
    return await kernels.run(notebook_id, payload.code)


@router.post("/notebooks/{notebook_id}/kernel/restart", status_code=status.HTTP_204_NO_CONTENT)
async def restart_kernel(notebook_id: str, kernels: KernelDep) -> None:
    await kernels.reset(notebook_id)


# -- uploads ---------------------------------------------------------------
@router.get("/uploads")
async def list_uploads(uploads: UploadDep) -> list[dict[str, object]]:
    return uploads.list()


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def upload(
    request: Request, uploads: UploadDep, name: Annotated[str, Query(min_length=1)]
) -> dict[str, object]:
    """Raw file body; the table is `uploads.<file stem>`."""
    declared = request.headers.get("content-length")
    if declared and int(declared) > MAX_BYTES:
        raise InvalidRequestError("The file is too large.")
    return await uploads.save(name, await request.body())


@router.post("/uploads/sync")
async def sync_uploads(uploads: UploadDep) -> dict[str, int]:
    return {"registered": await uploads.sync()}
