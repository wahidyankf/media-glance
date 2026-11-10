# Viewer shortcuts

These shortcuts apply while the media-glance browser viewer is open. They do not add Neovim mappings.

| Action                  | macOS      | Windows/Linux |
| ----------------------- | ---------- | ------------- |
| Open file finder        | ⌘K         | Ctrl+K        |
| Show or hide sidebar    | ⌘B         | Ctrl+B        |
| Narrow or widen sidebar | ← / →      | ← / →         |
| Sidebar min or max      | Home / End | Home / End    |
| Move through results    | ↑ / ↓      | ↑ / ↓         |
| Open selected file      | Enter      | Enter         |
| Close finder or overlay | Escape     | Escape        |

Typing in the finder searches saved files by filename or relative path. When no result is selected, Enter opens the
first match. Closing the finder restores focus to the control that opened it. The media overlay also closes with
Escape.

The sidebar shortcut hides or shows the explorer. It does nothing while the finder is open, while focus is in a text
field, or when other modifier keys are held.

Drag the sidebar's right edge with a mouse, pen, or touch to resize it. Double-click the edge to restore the default
width: 17rem, or 11rem in a window 700px wide or narrower. When the edge has focus, ← and → change the width by
16px, Shift with an arrow changes it by 64px, Home sets the minimum, and End sets the maximum. The width stays between
11rem and the smaller of 40rem or 60% of the window, and it is remembered for this viewer origin. The edge is out of
the tab order while the sidebar is hidden.
