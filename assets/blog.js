/* Kilobyte Thoughts — shared blog logic.
   Discovery is manifest-driven: posts/manifest.json lists which .md files
   to show and in what order. Add a post by (1) dropping the .md file in
   /posts, (2) adding its filename to manifest.json. Nothing else to touch. */

(function () {
  var POSTS_DIR = 'posts/';
  var MANIFEST_URL = POSTS_DIR + 'manifest.json';

  function parseFrontmatter(raw) {
    var match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) return { meta: {}, body: raw };
    var meta = {};
    match[1].split('\n').forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx === -1) return;
      var key = line.slice(0, idx).trim();
      var val = line.slice(idx + 1).trim();
      if (val.charAt(0) === '[' && val.charAt(val.length - 1) === ']') {
        val = val.slice(1, -1).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
      meta[key] = val;
    });
    return { meta: meta, body: match[2] };
  }

  function wordCount(text) {
    var matches = text.trim().match(/\S+/g);
    return matches ? matches.length : 0;
  }

  function readingMinutes(words) {
    return Math.max(1, Math.round(words / 200));
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Renders "Aug 22, 2026" or, when a post has been revised,
  // "Aug 22, 2026 (bumped: Aug 30, 2026)". Returns safe HTML.
  function formatDateLine(dateStr, bumpedStr) {
    var out = escapeHtml(formatDate(dateStr));
    if (bumpedStr) {
      out += ' <span class="bumped">(bumped: ' + escapeHtml(formatDate(bumpedStr)) + ')</span>';
    }
    return out;
  }

  function fetchManifest() {
    return fetch(MANIFEST_URL, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load manifest.json');
      return res.json();
    });
  }

  function fetchPost(filename) {
    return fetch(POSTS_DIR + filename, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load ' + filename);
      return res.text();
    }).then(function (raw) {
      var parsed = parseFrontmatter(raw);
      var meta = parsed.meta;
      var body = parsed.body;
      var words = wordCount(body);
      var slug = filename.replace(/\.md$/, '');
      var tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
      return {
        slug: slug,
        filename: filename,
        title: meta.title || slug,
        date: meta.date || '',
        bumped: meta.bumped || '',
        tags: tags,
        summary: meta.summary || '',
        body: body,
        words: words,
        minutes: readingMinutes(words)
      };
    });
  }

  function renderMarkdown(body) {
    var html = window.marked ? window.marked.parse(body) : escapeHtml(body);
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
  }

  window.KBThoughts = {
    fetchManifest: fetchManifest,
    fetchPost: fetchPost,
    renderMarkdown: renderMarkdown,
    formatDate: formatDate,
    formatDateLine: formatDateLine,
    escapeHtml: escapeHtml
  };
})();

/* ---- index.html: render the teaser list ---- */
document.addEventListener('DOMContentLoaded', function () {
  var container = document.getElementById('blog-list');
  if (!container) return;

  KBThoughts.fetchManifest().then(function (manifest) {
    if (!manifest || !manifest.length) {
      container.innerHTML = '<p class="lead">Nothing published yet — first post coming soon.</p>';
      return null;
    }
    return Promise.all(manifest.map(function (filename) {
      return KBThoughts.fetchPost(filename).catch(function () { return null; });
    }));
  }).then(function (posts) {
    if (!posts) return;
    var valid = posts.filter(Boolean).sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    if (!valid.length) {
      container.innerHTML = '<p class="lead">Nothing published yet — first post coming soon.</p>';
      return;
    }
    container.innerHTML = valid.map(function (p) {
      var tags = p.tags.map(function (t) {
        return '<span class="tag">' + KBThoughts.escapeHtml(t) + '</span>';
      }).join('');
      return (
        '<a class="blog-card" href="post.html?slug=' + encodeURIComponent(p.slug) + '">' +
          '<div class="blog-card__row">' +
            '<span class="blog-card__date">' + KBThoughts.formatDateLine(p.date, p.bumped) + '</span>' +
            '<span class="blog-card__time">' + p.minutes + ' min read</span>' +
          '</div>' +
          '<div class="blog-card__title">' + KBThoughts.escapeHtml(p.title) + ' <span class="arrow">↗</span></div>' +
          (p.summary ? '<p class="blog-card__summary">' + KBThoughts.escapeHtml(p.summary) + '</p>' : '') +
          (tags ? '<div class="blog-card__tags">' + tags + '</div>' : '') +
        '</a>'
      );
    }).join('');
  }).catch(function () {
    container.innerHTML = '<p class="lead">Couldn\u2019t load posts right now — try refreshing.</p>';
  });
});

/* ---- post.html: render a single full post ---- */
document.addEventListener('DOMContentLoaded', function () {
  var container = document.getElementById('post-root');
  if (!container) return;

  var slug = new URLSearchParams(window.location.search).get('slug');
  if (!slug) {
    container.innerHTML = '<p class="lead">No post specified. <a href="index.html#thoughts">Back to Kilobyte Thoughts</a></p>';
    return;
  }

  KBThoughts.fetchManifest().then(function (manifest) {
    var filename = (manifest || []).filter(function (f) {
      return f.replace(/\.md$/, '') === slug;
    })[0];
    if (!filename) throw new Error('not found');
    return KBThoughts.fetchPost(filename);
  }).then(function (post) {
    document.title = post.title + ' — Björn Ramberg';
    var tags = post.tags.map(function (t) {
      return '<span class="tag">' + KBThoughts.escapeHtml(t) + '</span>';
    }).join('');
    container.innerHTML =
      '<div class="terminal">' +
        '<div class="terminal__bar">' +
          '<span class="terminal__path"><span class="terminal__icon">&gt;_</span>cat ' + KBThoughts.escapeHtml(post.filename) + '</span>' +
          '<div class="terminal__controls" aria-hidden="true">' +
            '<span class="win-btn win-btn--min"><span></span></span>' +
            '<span class="win-btn win-btn--max"><span></span></span>' +
            '<span class="win-btn win-btn--close"><span></span></span>' +
          '</div>' +
        '</div>' +
        '<div class="post">' +
          '<div class="post__meta">' +
            '<span>' + KBThoughts.formatDateLine(post.date, post.bumped) + '</span>' +
            '<span>\u00b7</span>' +
            '<span>' + post.minutes + ' min read</span>' +
          '</div>' +
          '<h1 class="post__title">' + KBThoughts.escapeHtml(post.title) + '</h1>' +
          (tags ? '<div class="post__tags">' + tags + '</div>' : '') +
          '<div class="post__body">' + KBThoughts.renderMarkdown(post.body) + '</div>' +
        '</div>' +
      '</div>' +
      '<p class="post__back"><a href="index.html#thoughts">\u2190 back to Kilobyte Thoughts</a></p>';
  }).catch(function () {
    container.innerHTML = '<p class="lead">Couldn\u2019t find that post. <a href="index.html#thoughts">Back to Kilobyte Thoughts</a></p>';
  });
});
