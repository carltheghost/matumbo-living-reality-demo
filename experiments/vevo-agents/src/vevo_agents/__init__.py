"""Vevo Agents: a bounded five-brain local proof."""

__version__ = "0.1.0"

from .fabric import VevoState, SimFabricStore
from .physics import ResonantWorld
from .model import FiveBrain

__all__ = ["VevoState", "SimFabricStore", "ResonantWorld", "FiveBrain"]
