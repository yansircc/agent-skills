---
match: ^((command[[:space:]]+)|\\)?(rm|cp|mv)[[:space:]]+[^-[:space:]]
action: block
message: Use a non-interactive, alias-safe form such as command rm -f, command cp -f, or command mv -f.
---
# Interactive Shell Commands Must Skip Confirmation

Commands like `rm`, `cp`, and `mv` can block on shell aliases or overwrite prompts.

Use non-interactive, alias-safe forms:

- `command rm -f path`
- `command rm -rf dir`
- `command cp -f src dest`
- `command mv -f src dest`
- if a tool truly requires confirmation on stdin, pipe explicit input such as `printf 'y\n' | cmd`
