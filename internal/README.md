# Internal packages

`media/` owns Markdown rendering and file classification. The root Go package coordinates HTTP, registry publication,
workspace path rules, rooted file access, filesystem watches, and server ownership.

These packages are internal implementation details. The supported interfaces are the Neovim plugin and the CLI.
