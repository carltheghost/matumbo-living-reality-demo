# Vivo phone engine

This is the lightweight local compute/agent layer loaded by the GitHub Pages
Vivo surface.

- sparse 3–11D material state in a Worker
- simulation time remains separate
- adaptive active/idle stepping
- IndexedDB persistence
- offline cache
- bounded agent runtime + tool registry
- browser-native tools and optional Android Companion tools
- hands-free projection preparation

The sparse worker intentionally avoids a dense 11D grid. Its local analytic
spring rule is a lightweight browser fallback, not a claim that it replaces the
canonical recovered learned material model.

A normal browser page cannot acquire unrestricted Android privileges. Native
phone capabilities are supplied only by the optional Vivo Android Companion and
remain subject to Android/user permission.
