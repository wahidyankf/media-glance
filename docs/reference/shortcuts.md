# Viewer shortcuts

These shortcuts apply while the media-glance browser viewer is open. They do not add Neovim mappings.

| Action                   | macOS      | Windows/Linux |
| ------------------------ | ---------- | ------------- |
| Open file finder         | Ctrl+K     | Ctrl+K        |
| Show or hide sidebar     | ⌘B         | Ctrl+B        |
| Previous file in history | Ctrl+O     | Ctrl+O        |
| Next file in history     | Ctrl+I     | Ctrl+I        |
| Narrow or widen sidebar  | ← / →      | ← / →         |
| Sidebar min or max       | Home / End | Home / End    |
| Move through results     | ↑ / ↓      | ↑ / ↓         |
| Open selected file       | Enter      | Enter         |
| Close finder or overlay  | Escape     | Escape        |

Typing in the finder searches saved files by filename or relative path. When no result is selected, Enter opens the
first match. Closing the finder restores focus to the control that opened it. The media overlay also closes with
Escape. The finder opens with Ctrl+K on every platform; Cmd+K does nothing.

The sidebar shortcut hides or shows the explorer. It does nothing while the finder is open, while focus is in a text
field, or when other modifier keys are held.

Ctrl+O goes back and Ctrl+I goes forward through the files opened in this tab. It works like Vim's jumplist, but it
tracks files rather than cursor positions. Opening a new file after going back drops the forward entries. Opening the
current file again adds nothing, and a file that can no longer be opened is skipped and forgotten. The history lives in
memory, so a reload starts a new one. Both keys do nothing while the finder is open or focus is in a text field, and
they use Ctrl on macOS as well. A focused PDF pane swallows key presses, so these keys do nothing while a PDF has focus;
move focus to the page outside it first.

Drag the sidebar's right edge with a mouse, pen, or touch to resize it. Double-click the edge to restore the default
width: 17rem, or 11rem in a window 700px wide or narrower. When the edge has focus, ← and → change the width by
16px, Shift with an arrow changes it by 64px, Home sets the minimum, and End sets the maximum. The width stays between
11rem and the smaller of 40rem or 60% of the window, and it is remembered for this viewer origin. The edge is out of
the tab order while the sidebar is hidden.
