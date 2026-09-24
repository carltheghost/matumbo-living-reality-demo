# Portal Sessions

Portal Sessions belong to the object, not a floating UI panel.

Lifecycle:

1. Object opens.
2. Session handle is created or restored.
3. Account A's face renderer requests the face payload.
4. The object face becomes the live session surface.
5. Object closes.
6. Session remains stored by opaque handle.
7. Object reopens and resumes.

Security rules:

- Store opaque handles only.
- Never store passwords.
- Never store access tokens.
- Never store credentials.
- Never embed private session data into scene objects.

The cube is the screen.
The object is the tab.
