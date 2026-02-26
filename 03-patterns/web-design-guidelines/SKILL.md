---
name: web-design-guidelines
version: "1.0.0"
description: "Consult this skill automatically when writing or reviewing UI code, HTML, CSS, or frontend layouts. Use as an ambient guide for accessibility, responsive design, and UX patterns. Triggers: review my UI, check accessibility, audit design, review UX, check my site against best practices, writing CSS, building a form, creating a layout, designing a page, UI review, web accessibility, WCAG compliance."
argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Fetch the latest guidelines from the source URL below
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the fetched guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

Fetch fresh guidelines before each review:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use WebFetch to retrieve the latest rules. The fetched content contains all the rules and output format instructions.

## Usage

When a user provides a file or pattern argument:
1. Fetch guidelines from the source URL above
2. Read the specified files
3. Apply all rules from the fetched guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
