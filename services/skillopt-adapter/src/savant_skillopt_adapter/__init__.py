"""Savant ⇄ Microsoft SkillOpt adapter boundary."""

from .adapter.optimize import AdapterResult, evaluate_skill, optimize_skill, verify_budget
from .config.pin import EnginePin, load_engine_pin
from .runner.engines import CaseScore, Engine, MockEngine, SkillOptCliEngine, create_engine
from .sandbox.workspace import Sandbox, SandboxError
from .translator.units import (
    ChangeBudget,
    LockedRegionError,
    OptimizationCase,
    OptimizationUnit,
    mask_locked_regions,
    unmask_locked_regions,
)

__all__ = [
    "AdapterResult",
    "CaseScore",
    "ChangeBudget",
    "Engine",
    "EnginePin",
    "LockedRegionError",
    "MockEngine",
    "OptimizationCase",
    "OptimizationUnit",
    "Sandbox",
    "SandboxError",
    "SkillOptCliEngine",
    "create_engine",
    "evaluate_skill",
    "load_engine_pin",
    "mask_locked_regions",
    "optimize_skill",
    "unmask_locked_regions",
    "verify_budget",
]
