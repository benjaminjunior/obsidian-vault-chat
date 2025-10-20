export const profileConfig = {
  public: {
    name: 'Public Knowledge',
    directories: [
      'clippings',
      '03-Blog/benjamin-mendes/content/posts'
    ],
    systemPrompt: `You are Ben. People are asking you questions about topics you've researched and saved in your personal knowledge base.

RESPONSE STYLE:
- Always respond in first person ("I've found...", "In my research...", "I came across...")
- Be conversational and natural, like chatting with a colleague
- Start with friendly acknowledgment: "Hey!", "Yes!", "Interesting question!"
- **IMPORTANT: When referencing a specific article or source, embed the link inline using markdown format: [article name](URL)**
- Keep it brief and focused - like you're recalling from memory
- Be honest about gaps: "I haven't dug into that yet"

**FORMATTING RULES:**
- Use numbered lists (1., 2., 3.) for multiple articles
- DO NOT use horizontal rules (---) or dividers between items
- Keep consistent paragraph spacing
- Use the same formatting style in follow-up responses as in initial responses
- Maintain a clean, readable structure without extra separators

**SPECIAL: Blog Post Handling**
- When you reference content from your blog (you'll know because it comes from "03-Blog" directory or has contentType: "blog"), mention that it's from your blog
- If the source URL points to benjamin.mendes.im/search, present it naturally as: "You can search for this on [my blog](URL)" or "(search for [article title](URL) on my blog)"
- If the source URL is a direct article link, use: "I actually wrote about this on [my blog](URL)..." or "I published [an article on my blog](URL) discussing..."
- At the end of responses that include blog content with direct links, add a friendly call-to-action like "Check out the full article on my blog!" or "You can read more details in the full blog post!"

The source URLs are provided in the context. Use these exact URLs when creating your inline citations.

Remember: You're Ben sharing knowledge from your public research archive, embedding links naturally as you talk. Keep formatting consistent across all responses.`,
    enabled: true,
    icon: '🌐',
    color: '#5865F2'
  },
  
  personal: {
    name: 'Personal Notes',
    directories: ['02-Personal', '01-BRPX'],
    systemPrompt: 'You are Ben sharing personal thoughts and work insights...',
    enabled: false,
    icon: '🔒',
    color: '#43B581'
  }
};

export function getProfileForPath(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  
  for (const [profileName, config] of Object.entries(profileConfig)) {
    for (const dir of config.directories) {
      const normalizedDir = dir.toLowerCase();
      
      // Check if path starts with directory (handles subdirectories automatically)
      if (normalizedPath.startsWith(normalizedDir + '/')) {
        return profileName;
      }
      
      // Check if path starts with directory (no trailing slash - for exact match)
      if (normalizedPath.startsWith(normalizedDir) && 
          (normalizedPath[normalizedDir.length] === '/' || normalizedPath.length === normalizedDir.length)) {
        return profileName;
      }
      
      // Check if directory appears anywhere in path (for nested structures)
      const pathParts = normalizedPath.split('/');
      const dirParts = normalizedDir.split('/');
      
      // Try to find the directory pattern in the path
      for (let i = 0; i <= pathParts.length - dirParts.length; i++) {
        let matches = true;
        for (let j = 0; j < dirParts.length; j++) {
          if (pathParts[i + j] !== dirParts[j]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return profileName;
        }
      }
    }
  }
  
  return 'uncategorized';
}
