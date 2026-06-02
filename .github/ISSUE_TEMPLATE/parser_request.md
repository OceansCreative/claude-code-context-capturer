---
name: Site parser request
about: Ask for a new site-specific parser (or a PR — see README "Adding a new site parser")
title: '[parser] '
labels: enhancement, parser
---

## Site

<!-- Domain and (if relevant) URL pattern, e.g. "youtube.com/watch?v=..." -->

## Why a site-specific parser instead of the generic Readability fallback

<!-- The generic parser usually does fine. Site-specific parsers exist when:
       - the site is a SPA whose DOM is missing structure (claude.ai)
       - there's important metadata Readability drops (Stack Overflow vote counts, GitHub PR labels)
       - the conversation / thread / comments structure matters (Reddit, HN)
     Which one applies here? -->

## What should the captured Markdown look like

<!-- A rough sketch — frontmatter fields, headings hierarchy, what to include vs drop.
     If you've tried the generic parser and the output is wrong, paste the actual output
     and mark what's missing or wrong. -->

## Internal API or DOM-only

<!-- DOM-only is much easier. If the site has an internal API (like claude.ai's), say so and
     point at the endpoint. Authenticated APIs work because content scripts inherit the user's
     session cookies. -->

## Anything else

<!-- Will this need a new Chrome permission? (We try very hard to avoid permission additions
     because they trigger Web Store re-review.) -->
