module.exports = function(eleventyConfig) {
    // Templates and assets configuration
    eleventyConfig.setTemplateFormats([
          "html",
          "njk",
          "md",
          "css",
          "scss",
          "js",
          "mjs",
          "json",
          "xml",
          "txt",
          "pdf",
          "docx",
          "ico",
          "mp3",
          "mp4",
          "jpeg",
          "jpg",
          "webp",
          "png",
          "svg",
          "woff",
          "woff2"
        ]);

    // Passthrough copy
    eleventyConfig.addPassthroughCopy("assets");
    eleventyConfig.addPassthroughCopy("admin");

    // Configure Markdown
    let markdownIt = require("markdown-it");
    let options = {
        html: true,
        breaks: true,
        linkify: true
    };
    eleventyConfig.setLibrary("md", markdownIt(options));

    // Items collection
    eleventyConfig.addCollection("items", function(collection) {
        return collection.getFilteredByGlob("src/items/*.md").sort((a, b) => {
            return a.date - b.date;
        });
    });

    // Directory configuration
    return {
        dir: {  
            input: "src",
            includes: "_includes",
            output: "_site"
        }
    };
};