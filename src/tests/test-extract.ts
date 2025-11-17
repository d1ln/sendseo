// tests/test-extract.ts
import { extractStructure } from "../extract";

const SAMPLE_HTML = `
<div id="primary" class="content-area col-md-9">

    <aside id="hosted_breadcrumbs-2" class="widget widget_breadcrumbs clearfix"><ol class='breadcrumb'><li><a title="Go to main listing" href="https://www.domains.co.za/blog" rel="nofollow">Home</a></li>        <li><a title="Tech News" href="https://www.domains.co.za/blog/category/tech-news/" >Tech News</a></li>
                <li><a title="cPanel Web Hosting" href="https://www.domains.co.za/blog/category/product-information/cpanel-web-hosting/" >cPanel Web Hosting</a></li>
        <li>Reddit vs Perplexity: The Opening Shots In The AI Data Arms Race</li></ol></aside>
        <main id="main" class="site-main" role="main">

        
            
<article id="post-4004" class="post post-large post-4004 type-post status-publish format-standard has-post-thumbnail hentry category-tech-news category-cpanel-web-hosting tag-reddit-vs-perplexity">

      <div class="post-image single">
      <a href="https://www.domains.co.za/blog/reddit-vs-perplexity/" title="Reddit vs Perplexity: The Opening Shots In The AI Data Arms Race">
        <img width="960" height="374" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class="img-thumbnail wp-post-image lazyload" alt="Header Text - What the Reddit vs Perplexity Lawsuit Could Mean for Your Content" decoding="async" sizes="(max-width: 960px) 100vw, 960px" data-src="https://www.domains.co.za/blog/wp-content/uploads/2025/11/reddit-vs-perplexity-01.webp" data-srcset="https://www.domains.co.za/blog/wp-content/uploads/2025/11/reddit-vs-perplexity-01.webp 960w, https://www.domains.co.za/blog/wp-content/uploads/2025/11/reddit-vs-perplexity-01-300x117.webp 300w, https://www.domains.co.za/blog/wp-content/uploads/2025/11/reddit-vs-perplexity-01-768x299.webp 768w, https://www.domains.co.za/blog/wp-content/uploads/2025/11/reddit-vs-perplexity-01-603x235.webp 603w, https://www.domains.co.za/blog/wp-content/uploads/2025/11/reddit-vs-perplexity-01-930x363.webp 930w">      </a>
    </div><!-- .post-thumnail -->
  
    <div class="post-date"><span class="day">07</span><span class="month">Nov</span></div>
  
  <div class="post-date" title="9mins to read"><span class="day">9</span><span class="month"><i class="fa fa-clock-o"></i></span></div>
    <div id="hosted_bootstrap-entry-content" class="post-content">

    
      <h1
        itemprop="name" class="entry-title">
       <a href="https://www.domains.co.za/blog/reddit-vs-perplexity/" title="Reddit vs Perplexity: The Opening Shots In The AI Data Arms Race" rel="bookmark">Reddit vs Perplexity: The Opening Shots In The AI Data Arms Race</a>
      </h1>


    <div itemprop="text">
        <div id="bsf_rt_marker"></div>
<p>Reddit filed a lawsuit against Perplexity AI earlier this month, accusing the AI company of unlawfully scraping its platform through backdoor methods. Which raises a pretty important question: where’s the line between open and fair data access and unauthorised scraping? At first glance, this might sound like just two tech companies at each other&#8217;s throats. But beneath the surface, it’s a fight over the value of online content and who deserves to benefit from it. In fact, the court’s ruling on the Reddit vs Perplexity case could potentially shape how sites and <a href="https://www.domains.co.za/web-hosting-south-africa">Web Hosting</a> providers manage and protect content, not to mention how AI models access and use data.</p>



<h4 class="wp-block-heading" id="key-takeaways">KEY TAKEAWAYS</h4>



<ul class="wp-block-list">
<li>Reddit claims Perplexity knowingly bypassed technical defences to scrape data indirectly via Google search results.</li>



<li>Traditional crawlers index content to drive website traffic; AI crawlers gather content to generate answers, often not directing visitors to websites.</li>
`;

async function run() {
  try {
    const extracted = extractStructure(
      SAMPLE_HTML,
      "https://www.domains.co.za/blog/reddit-vs-perplexity/",
    );
    console.log("=== EXTRACTED ===");
    console.log(JSON.stringify(extracted, null, 2));
  } catch (err) {
    console.error("extract test failed", err);
  }
}

run();
