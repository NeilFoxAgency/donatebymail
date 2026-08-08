import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, FileText } from "lucide-react";

type ArticleBlock =
  | { type: "paragraph" | "quote"; text: string }
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "list"; items: string[] }
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
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.articleStructuredData = "true";
    script.textContent = JSON.stringify({
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
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [article]);
  return null;
}

function ArticleBlocks({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="article-body">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading = `h${block.level}` as "h2" | "h3" | "h4";
          return <Heading key={index}>{block.text}</Heading>;
        }
        if (block.type === "paragraph") return <p key={index}>{block.text}</p>;
        if (block.type === "quote") return <blockquote key={index}>{block.text}</blockquote>;
        if (block.type === "list") return <ul key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
        if (block.type !== "link") return null;
        return (
          <p className="article-inline-link" key={index}>
            <a href={block.href} rel={block.href.startsWith("https://") ? "noopener noreferrer" : undefined} target={block.href.startsWith("https://") ? "_blank" : undefined}>
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
    setLoading(true); setError("");
    const endpoint = slug ? `/api/articles/${encodeURIComponent(slug)}` : "/api/articles";
    fetch(endpoint, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        const raw = await response.text();
        let body: { articles?: ArticleSummary[]; article?: Article; message?: string };
        try {
          body = JSON.parse(raw) as { articles?: ArticleSummary[]; article?: Article; message?: string };
        } catch {
          throw new Error("We could not load articles right now. Please try again.");
        }
        if (!response.ok) throw new Error(body.message || "We could not load articles right now.");
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
