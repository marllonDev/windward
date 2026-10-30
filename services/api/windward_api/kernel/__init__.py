"""Python notebook cells: one persistent worker process per notebook."""

from .manager import KernelManager

__all__ = ["KernelManager"]
