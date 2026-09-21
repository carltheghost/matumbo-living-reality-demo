# Persistent User Blocks

The Living Reality field now supports independent user-created simulation blocks that behave like persistent workspace windows.

## Behavior

A block can be created from the BLOCKS launcher as a workspace, media, social, or market surface. The user can also create a named custom block.

Each block has its own stable id and independent transform:
- drag horizontally or vertically;
- SHIFT-drag to move it in depth;
- use the location selector to dock LEFT, RIGHT, FRONT, TOP, or leave it FREE;
- click a block without moving it to focus it without changing its position;
- hide and reopen it from the BLOCKS launcher.

The layout is stored under matumbo.persistent.blocks.v1. The saved record contains the block definition and its layout, so custom blocks survive reloads.

## No-jump navigation rule

Persistent blocks are intentionally outside Mission Control / Feature Navigator. Opening another feature does not close, recenter, rebuild, overwrite, or reset a persistent block.

The block only moves when the user moves or docks it.

## Hand interaction

The existing Hand Lens bridge emits sanitized tap and swipe metadata. The block workspace listens to those events:
- swipe left/right cycles focus across visible blocks;
- a tap on a block focuses that block and activates the selected local control.

No raw camera frames, hand landmarks, credentials, or provider payloads enter the persistent-block state.

## Simulation boundary

Built-in blocks such as Prime-style Media and Social Space are UI simulations. They do not claim a live provider session. No streaming account, social account, wallet, payment, settlement, or external execution is created by this module.

The existing air keyboard remains its own surface and can be opened alongside these blocks.
