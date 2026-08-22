---
"@theokit/codemod-sdk-2-0": patch
---

The codemod wrote `<path>.bak` with `copyFile`, which follows symlinks. That name is predictable
from any file in the tree, so a symlink planted there received the file's contents — anywhere on
the filesystem the process could reach.

This runs on a consumer's repository, so "someone placed a file in the tree" is the ordinary
situation rather than a privileged one.

The backup is now written with `O_NOFOLLOW`: the kernel refuses a symlink outright, and the codemod
stops with a message naming the path rather than writing through it. An existing regular `.bak` is
still overwritten, so every legitimate run is unchanged.
