import { describe, it, expect, beforeEach } from 'vitest';
import {
  canHandleArxiv,
  parseArxiv,
  extractArxivRef,
} from '@/content/parsers/arxiv';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Fixture builder — mirrors arXiv's abstract-page structure (citation_* meta
// tags in <head>, the title / authors / abstract / metatable in <body>).
// ---------------------------------------------------------------------------

interface PaperFixture {
  url: string;
  id: string;
  /** Current version shown in the metatable's versioned id link. */
  currentVersion?: string;
  title: string;
  /** DOM author display names ("First Last"). */
  authors: string[];
  abstract: string;
  /** citation_author values ("Last, First"); defaults derived from `authors`. */
  metaAuthors?: string[];
  /** Subjects cell inner HTML. */
  subjectsHtml: string;
  dateline: string;
  comments?: string;
  journalRef?: string;
  doi?: { id: string; url: string };
  pdfUrl?: string;
  /** citation_date, "YYYY/MM/DD". */
  date?: string;
  /** Emit the citation_* meta tags (default true). */
  withMeta?: boolean;
  /** Emit the DOM title/authors/abstract (default true). */
  withDom?: boolean;
  docTitle?: string;
}

function mountPaper(p: PaperFixture): void {
  setLocation(p.url);
  document.title = p.docTitle ?? `[${p.id}] ${p.title}`;

  const metaAuthors =
    p.metaAuthors ??
    p.authors.map((a) => {
      const parts = a.split(' ');
      const last = parts.pop() ?? a;
      return `${last}, ${parts.join(' ')}`.replace(/,\s*$/, '');
    });

  const head: string[] = [];
  if (p.withMeta !== false) {
    head.push(`<meta name="citation_title" content="${p.title}" />`);
    for (const a of metaAuthors) {
      head.push(`<meta name="citation_author" content="${a}" />`);
    }
    if (p.date) head.push(`<meta name="citation_date" content="${p.date}" />`);
    head.push(
      `<meta name="citation_pdf_url" content="${p.pdfUrl ?? `https://arxiv.org/pdf/${p.id}`}" />`
    );
    head.push(`<meta name="citation_arxiv_id" content="${p.id}" />`);
    head.push(`<meta name="citation_abstract" content="${p.abstract}" />`);
  }
  document.head.innerHTML = head.join('\n');

  const versionLink = p.currentVersion
    ? `<tr><td class="tablecell label">&nbsp;</td><td class="tablecell arxividv">(or <span class="arxivid"><a href="https://arxiv.org/abs/${p.id}v${p.currentVersion}">arXiv:${p.id}v${p.currentVersion}</a></span> for this version)</td></tr>`
    : '';
  const commentsRow = p.comments
    ? `<tr><td class="tablecell label">Comments:</td><td class="tablecell comments mathjax">${p.comments}</td></tr>`
    : '';
  const jrefRow = p.journalRef
    ? `<tr><td class="tablecell label">Journal&nbsp;reference:</td><td class="tablecell jref">${p.journalRef}</td></tr>`
    : '';
  const doiRow = p.doi
    ? `<tr><td class="tablecell label">Related DOI:</td><td class="tablecell doi"><a href="${p.doi.url}" data-doi="${p.doi.id}">${p.doi.url}</a></td></tr>`
    : '';

  const domBlocks: string[] = [];
  if (p.withDom !== false) {
    domBlocks.push(
      `<h1 class="title mathjax"><span class="descriptor">Title:</span>${p.title}</h1>`
    );
    const authorLinks = p.authors
      .map((a) => `<a href="https://arxiv.org/a/x" rel="nofollow">${a}</a>`)
      .join(', ');
    domBlocks.push(
      `<div class="authors"><span class="descriptor">Authors:</span>${authorLinks}</div>`
    );
    domBlocks.push(
      `<blockquote class="abstract mathjax"><span class="descriptor">Abstract:</span>${p.abstract}</blockquote>`
    );
  }

  document.body.innerHTML = `
    ${domBlocks.join('\n')}
    <div class="dateline">${p.dateline}</div>
    <div class="metatable">
      <table summary="Additional metadata">
        ${commentsRow}
        <tr><td class="tablecell label">Subjects:</td><td class="tablecell subjects">${p.subjectsHtml}</td></tr>
        <tr><td class="tablecell label">Cite as:</td><td class="tablecell arxivid"><span class="arxivid"><a href="https://arxiv.org/abs/${p.id}">arXiv:${p.id}</a></span></td></tr>
        ${versionLink}
        ${jrefRow}
        ${doiRow}
      </table>
    </div>`;
}

const SUBJECTS_TRANSFORMER =
  '<span class="primary-subject">Computation and Language (cs.CL)</span>; Machine Learning (cs.LG)';

const ATTENTION: PaperFixture = {
  url: 'https://arxiv.org/abs/1706.03762',
  id: '1706.03762',
  currentVersion: '7',
  title: 'Attention Is All You Need',
  authors: [
    'Ashish Vaswani',
    'Noam Shazeer',
    'Niki Parmar',
    'Jakob Uszkoreit',
    'Llion Jones',
    'Aidan N. Gomez',
    'Lukasz Kaiser',
    'Illia Polosukhin',
  ],
  abstract:
    'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.',
  subjectsHtml: SUBJECTS_TRANSFORMER,
  dateline:
    '[Submitted on 12 Jun 2017 (<a href="https://arxiv.org/abs/1706.03762v1">v1</a>), last revised 2 Aug 2023 (this version, v7)]',
  comments: '15 pages, 5 figures',
  date: '2017/06/12',
};

describe('arXiv parser', () => {
  describe('extractArxivRef', () => {
    it('parses new-style ids with and without a version', () => {
      expect(extractArxivRef('/abs/1706.03762')).toEqual({
        id: '1706.03762',
        version: undefined,
      });
      expect(extractArxivRef('/abs/1706.03762v7')).toEqual({
        id: '1706.03762',
        version: '7',
      });
      expect(extractArxivRef('/pdf/2301.00001')).toEqual({
        id: '2301.00001',
        version: undefined,
      });
    });

    it('parses old-style archive ids', () => {
      expect(extractArxivRef('/abs/hep-ph/9901001')).toEqual({
        id: 'hep-ph/9901001',
        version: undefined,
      });
      expect(extractArxivRef('/abs/math.AG/0601001v2')).toEqual({
        id: 'math.AG/0601001',
        version: '2',
      });
    });

    it('strips a trailing .pdf on /pdf paths', () => {
      expect(extractArxivRef('/pdf/1706.03762.pdf')).toEqual({
        id: '1706.03762',
        version: undefined,
      });
    });

    it('returns undefined for non-paper paths', () => {
      expect(extractArxivRef('/list/cs.AI/recent')).toBeUndefined();
      expect(extractArxivRef('/find/all')).toBeUndefined();
      expect(extractArxivRef('/')).toBeUndefined();
      expect(extractArxivRef('/abs/')).toBeUndefined();
      expect(extractArxivRef('/abs/not-an-id')).toBeUndefined();
    });
  });

  describe('canHandleArxiv', () => {
    it('accepts /abs/<id> pages', () => {
      setLocation('https://arxiv.org/abs/1706.03762');
      expect(canHandleArxiv()).toBe(true);
      setLocation('https://arxiv.org/abs/1706.03762v2');
      expect(canHandleArxiv()).toBe(true);
    });

    it('accepts /pdf/<id> pages', () => {
      setLocation('https://arxiv.org/pdf/1706.03762');
      expect(canHandleArxiv()).toBe(true);
      setLocation('https://arxiv.org/pdf/1706.03762v7');
      expect(canHandleArxiv()).toBe(true);
    });

    it('accepts old-style archive ids', () => {
      setLocation('https://arxiv.org/abs/hep-ph/9901001');
      expect(canHandleArxiv()).toBe(true);
      setLocation('https://www.arxiv.org/pdf/cond-mat/0102536');
      expect(canHandleArxiv()).toBe(true);
    });

    it('rejects listing / search / home pages', () => {
      setLocation('https://arxiv.org/list/cs.AI/recent');
      expect(canHandleArxiv()).toBe(false);
      setLocation('https://arxiv.org/');
      expect(canHandleArxiv()).toBe(false);
    });

    it('rejects non-arxiv hosts', () => {
      setLocation('https://example.com/abs/1706.03762');
      expect(canHandleArxiv()).toBe(false);
      // A lookalike path on another host must not match.
      setLocation('https://notarxiv.org/abs/1706.03762');
      expect(canHandleArxiv()).toBe(false);
    });
  });

  describe('parseArxiv', () => {
    beforeEach(() => {
      document.head.innerHTML = '';
      document.body.innerHTML = '';
    });

    it('captures a normal abstract page', async () => {
      mountPaper(ATTENTION);
      const ctx = await parseArxiv();

      expect(ctx.parser).toBe('arxiv');
      expect(ctx.fromSelection).toBe(false);
      expect(ctx.title).toBe('Attention Is All You Need');
      expect(ctx.body).toContain('# Attention Is All You Need');
      expect(ctx.body).toContain('## Abstract');
      expect(ctx.body).toContain('The dominant sequence transduction models');

      // Metadata block.
      expect(ctx.body).toContain('## Metadata');
      // Version resolved from the metatable link even though the URL had none.
      expect(ctx.body).toContain('- **arXiv:** 1706.03762v7');
      expect(ctx.body).toContain(
        '- **Categories:** Computation and Language (cs.CL); Machine Learning (cs.LG)'
      );
      expect(ctx.body).toContain('- **Comments:** 15 pages, 5 figures');
      expect(ctx.body).toContain(
        '- **Submitted:** 12 Jun 2017 (v1), last revised 2 Aug 2023 (this version, v7)'
      );
      expect(ctx.body).toContain('- **PDF:** https://arxiv.org/pdf/1706.03762');
      expect(ctx.body).toContain('- **Abstract page:** https://arxiv.org/abs/1706.03762v7');

      expect(ctx.tags).toEqual(['arxiv', 'cs.CL', 'cs.LG']);
      expect(ctx.dedupeKey).toBe('arxiv:1706.03762');
      expect(ctx.publishedAt).toBe('2017-06-12T00:00:00.000Z');
      // Canonical abs page (versioned) is the capture url, not /pdf.
      expect(ctx.url).toBe('https://arxiv.org/abs/1706.03762v7');
    });

    it('lists every author and collapses the frontmatter author field', async () => {
      mountPaper(ATTENTION);
      const ctx = await parseArxiv();

      expect(ctx.body).toContain(
        '**Authors:** Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Lukasz Kaiser, Illia Polosukhin'
      );
      // >3 authors → compact "et al." in frontmatter.
      expect(ctx.author).toBe('Ashish Vaswani et al.');
    });

    it('keeps the full author list in the frontmatter field for small papers', async () => {
      mountPaper({
        ...ATTENTION,
        url: 'https://arxiv.org/abs/2401.00001',
        id: '2401.00001',
        currentVersion: undefined,
        authors: ['Ada Lovelace', 'Alan Turing'],
      });
      const ctx = await parseArxiv();
      expect(ctx.author).toBe('Ada Lovelace, Alan Turing');
      // No version anywhere → bare id.
      expect(ctx.body).toContain('- **arXiv:** 2401.00001');
    });

    it('captures a published paper with a version in the URL, journal ref, and DOI', async () => {
      mountPaper({
        url: 'https://arxiv.org/abs/1207.7214v2',
        id: '1207.7214',
        currentVersion: '2',
        title:
          'Observation of a new particle in the search for the Standard Model Higgs boson',
        authors: ['ATLAS Collaboration'],
        metaAuthors: ['ATLAS Collaboration'],
        abstract: 'A search for the Standard Model Higgs boson is presented.',
        subjectsHtml:
          '<span class="primary-subject">High Energy Physics - Experiment (hep-ex)</span>',
        dateline:
          '[Submitted on 31 Jul 2012 (v1), last revised 31 Aug 2012 (this version, v2)]',
        comments: '24 pages, 12 figures',
        journalRef: 'Phys.Lett. B716 (2012) 1-29',
        doi: {
          id: '10.1016/j.physletb.2012.08.020',
          url: 'https://doi.org/10.1016/j.physletb.2012.08.020',
        },
        date: '2012/07/31',
      });
      const ctx = await parseArxiv();

      // Version comes straight from the URL.
      expect(ctx.body).toContain('- **arXiv:** 1207.7214v2');
      expect(ctx.body).toContain('- **Journal reference:** Phys.Lett. B716 (2012) 1-29');
      expect(ctx.body).toContain(
        '- **DOI:** [10.1016/j.physletb.2012.08.020](https://doi.org/10.1016/j.physletb.2012.08.020)'
      );
      expect(ctx.tags).toEqual(['arxiv', 'hep-ex']);
      // Collaboration name (no comma) passes through intact.
      expect(ctx.author).toBe('ATLAS Collaboration');
      expect(ctx.dedupeKey).toBe('arxiv:1207.7214');
    });

    it('falls back to the DOM (and reformats meta authors) when meta tags are absent', async () => {
      // No citation_* meta tags: title/abstract must come from the DOM.
      mountPaper({ ...ATTENTION, withMeta: false });
      const ctx = await parseArxiv();

      expect(ctx.title).toBe('Attention Is All You Need');
      expect(ctx.body).toContain('The dominant sequence transduction models');
      expect(ctx.body).toContain('**Authors:** Ashish Vaswani,');
      // No citation_date → no published date.
      expect(ctx.publishedAt).toBeUndefined();
    });

    it('reformats "Last, First" meta authors when DOM author links are missing', async () => {
      // Emit meta (incl. citation_author) but no DOM title/authors/abstract…
      mountPaper({ ...ATTENTION, withDom: false });
      const ctx = await parseArxiv();
      // …so authors must be reconstructed from citation_author "Last, First".
      expect(ctx.body).toContain('**Authors:** Ashish Vaswani, Noam Shazeer,');
    });

    it('throws a friendly error when the abstract is missing', async () => {
      setLocation('https://arxiv.org/abs/1706.03762');
      document.head.innerHTML = '';
      document.title = '[1706.03762] Something';
      // A page with a title but no abstract (unexpected layout / still loading).
      document.body.innerHTML =
        '<h1 class="title mathjax"><span class="descriptor">Title:</span>Something</h1>';

      await expect(parseArxiv()).rejects.toThrow(/could not find the abstract/i);
    });
  });
});
