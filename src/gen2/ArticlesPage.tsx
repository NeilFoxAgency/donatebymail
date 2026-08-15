import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, FileText } from "lucide-react";
import { publicApi } from "./AuthSession";
import { safeJsonLdText } from "./jsonLd";

type ArticleBlock =
  | { type: "paragraph" | "quote"; text: string }
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "link"; label: string; href: string };

type ArticleSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  authorName: string;
  publishedAt: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  updatedAt?: string | null;
};

type Article = ArticleSummary & {
  contentBlocks: ArticleBlock[];
  contentHash: string;
  revisionId: string;
  version: number;
};

const SITE_ORIGIN = "https://donatebymail.org";

// Article links are authored content. Keep the renderer defensive even when
// an older revision predates the database URL constraint or an upstream
// response has been tampered with: only site-root paths and HTTPS URLs are
// allowed, never protocol-relative or script/data links.
function safeArticleHref(value: string): string | null {
  const href = value.trim();
  // Browsers treat backslashes as URL separators. Reject them before
  // accepting a root-relative path so `/\\evil` cannot become external.
  if (!href || /[\s\\<>"']/.test(href)) return null;
  if (href.startsWith("/")) return href.startsWith("//") ? null : href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && !url.username && !url.password ? href : null;
  } catch {
    return null;
  }
}

function setMeta(name: string, content: string, property = false) {
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    if (property) element.setAttribute("property", name);
    else element.name = name;
    document.head.appendChild(element);
  }
  element.content = content;
}

function ArticleJsonLd({ article }: { article: Article }) {
  useEffect(() => {
    const existing = document.head.querySelector<HTMLScriptElement>(
      'script[type="application/ld+json"][data-article-structured-data="true"]',
    );
    const script = existing || document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.articleStructuredData = "true";
    script.textContent = safeJsonLdText({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.seoDescription || article.excerpt,
      author: { "@type": "Organization", name: article.authorName },
      datePublished: article.publishedAt,
      dateModified: article.updatedAt || article.publishedAt,
      image: `${SITE_ORIGIN}/resources/phone-donation-hero.png`,
      mainEntityOfPage: `${SITE_ORIGIN}/articles/${article.slug}`,
      publisher: { "@type": "Organization", name: "Donate by Mail", url: SITE_ORIGIN },
    });
    if (!existing) document.head.appendChild(script);
    // The metadata is route-specific. Remove a server-injected script on
    // unmount so client-side navigation cannot leave stale article schema on
    // the blog index or another article.
    return () => { script.remove(); };
  }, [article]);
  return null;
}

function ArticleBlocks({ blocks }: { blocks: ArticleBlock[] }) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  return (
    <div className="article-body">
      {safeBlocks.map((block, index) => {
        if (!block || typeof block !== "object" || typeof block.type !== "string") return null;
        if (block.type === "heading") {
          if (typeof block.text !== "string" || block.level !== 2 && block.level !== 3 && block.level !== 4) return null;
          const Heading = `h${block.level}` as "h2" | "h3" | "h4";
          return <Heading key={index}>{block.text}</Heading>;
        }
        if (block.type === "paragraph") return typeof block.text === "string" ? <p key={index}>{block.text}</p> : null;
        if (block.type === "quote") return typeof block.text === "string" ? <blockquote key={index}>{block.text}</blockquote> : null;
        if (block.type === "list") {
          if (!Array.isArray(block.items)) return null;
          const items = block.items.filter((item): item is string => typeof item === "string");
          if (!items.length) return null;
          const List = block.ordered === true ? "ol" : "ul";
          return <List key={index}>{items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</List>;
        }
        if (block.type !== "link") return null;
        if (typeof block.label !== "string" || typeof block.href !== "string") return null;
        const href = safeArticleHref(block.href);
        if (!href) return null;
        const external = /^https:\/\//i.test(href);
        return (
          <p className="article-inline-link" key={index}>
            <a href={href} rel={external ? "noopener noreferrer" : undefined} target={external ? "_blank" : undefined}>
              {block.label} <ArrowRight aria-hidden="true" />
            </a>
          </p>
        );
      })}
    </div>
  );
}

function ArticleCard({ article }: { article: ArticleSummary }) {
  return (
    <article className="article-card">
      <div className="article-card-mark" aria-hidden="true"><FileText /></div>
      <p className="article-meta"><CalendarDays aria-hidden="true" /> <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString("en-US", { dateStyle: "long" })}</time></p>
      <h2><a href={`/articles/${article.slug}`}>{article.title}</a></h2>
      <p>{article.excerpt}</p>
      <p className="article-byline">By {article.authorName}</p>
      <a className="text-link" href={`/articles/${article.slug}`}>Read article <ArrowRight aria-hidden="true" /></a>
    </article>
  );
}

export function ArticlesPage({ slug }: { slug?: string }) {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // Dynamic article routes may reuse this component. Do not render the
    // previous article while the new slug (or list) is still loading.
    setArticle(null);
    if (!slug) setArticles([]);
    setLoading(true); setError("");
    const endpoint = slug ? `/api/articles/${encodeURIComponent(slug)}` : "/api/articles";
    publicApi<{ articles?: ArticleSummary[]; article?: Article }>(endpoint)
      .then((body) => {
        if (!active) return;
        if (slug) setArticle(body.article || null); else setArticles(body.articles || []);
      })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!article) return;
    const title = article.seoTitle || `${article.title} | Donate by Mail`;
    const description = article.seoDescription || article.excerpt;
    document.title = title;
    setMeta("description", description);
    setMeta("og:title", title, true); setMeta("og:description", description, true);
    setMeta("og:type", "article", true);
    setMeta("og:url", `${SITE_ORIGIN}/articles/${article.slug}`, true);
    setMeta("og:image", `${SITE_ORIGIN}/resources/phone-donation-hero.png`, true);
    setMeta("og:image:alt", "Donate by Mail phone donation", true);
    setMeta("twitter:title", title); setMeta("twitter:description", description);
    setMeta("twitter:card", "summary_large_image"); setMeta("twitter:image", `${SITE_ORIGIN}/resources/phone-donation-hero.png`);
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]') || document.head.appendChild(Object.assign(document.createElement("link"), { rel: "canonical" }));
    const previous = canonical.href; canonical.href = `${SITE_ORIGIN}/articles/${article.slug}`;
    return () => { document.title = "Donate an Old Phone to a Charity You Choose | Donate by Mail"; setMeta("description", "Donate an old phone by mail and choose a nonprofit you care about. Donate by Mail is a U.S. 501(c)(3) public charity with a simple guided process."); canonical.href = previous || `${SITE_ORIGIN}/`; };
  }, [article]);

  return (
    <main id="main-content" className="articles-page">
      <div className="articles-shell">
        <nav className="article-breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span>{slug ? article?.title || "Article" : "Blog"}</span></nav>
        {loading && <p className="article-status" role="status">Loading articles…</p>}
        {error && <div className="article-error" role="alert"><p>{error}</p><a className="text-link" href="/articles">Try again <ArrowRight aria-hidden="true" /></a></div>}
        {!loading && !error && slug && article && <>
          <ArticleJsonLd article={article} />
          <article className="article-detail">
            <p className="kicker">From Donate by Mail</p>
            <h1>{article.title}</h1>
            <p className="article-dek">{article.excerpt}</p>
            <p className="article-meta">By {article.authorName} · <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString("en-US", { dateStyle: "long" })}</time></p>
            <ArticleBlocks blocks={article.contentBlocks} />
            <p className="article-integrity">Article revision {article.version} · content checksum {article.contentHash}</p>
          </article>
          <a className="text-link article-back" href="/articles"><ArrowLeft aria-hidden="true" /> Back to Blog</a>
        </>}
        {!loading && !error && slug && !article && <div className="article-error" role="alert"><h1>Article not found</h1><p>That article may have moved or is not published yet.</p><a className="text-link" href="/articles">Browse articles <ArrowRight aria-hidden="true" /></a></div>}
        {!loading && !error && !slug && <>
          <header className="articles-heading"><p className="kicker">Ideas, guidance, and updates</p><h1>Blog</h1><p>Practical notes about donating old phones, choosing a nonprofit, and the work behind a clear mail-in process.</p></header>
          {articles.length ? <div className="article-grid">{articles.map((item) => <ArticleCard key={item.id} article={item} />)}</div> : <section className="articles-empty"><FileText aria-hidden="true" /><h2>New articles are on the way.</h2><p>We’re preparing practical guidance for donors and nonprofit partners.</p><a className="button primary" href="/donate-phone.html">Donate a Phone <ArrowRight aria-hidden="true" /></a></section>}
        </>}
      </div>
    </main>
  );
}
