# Changelog

## Unreleased

### Added

- Android file managers can open supported CAD documents with MB Viewer through **Open with**. Android manages the default app selection.
- STEP import retries tessellation one part at a time with a newer OpenCASCADE build when the primary engine returns no displayable triangles. The retry preserves the assembly hierarchy and placements.

### Fixed

- STEP documents supplied with a `.bin` filename or without an extension are recognized by their STEP header. The Android picker lets users select documents reported as generic binary files.
- Android settings explain how to choose a default app and hide the Windows association switches.
- CAD import errors report when MB Viewer could not extract displayable geometry.
