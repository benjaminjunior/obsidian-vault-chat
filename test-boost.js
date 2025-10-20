function keywordBoost(text, fileName, query) {
  const textLower = (text + ' ' + fileName).toLowerCase();
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let boost = 0;
  
  console.log(`\nAnalyzing: "${fileName}"`);
  console.log(`Query: "${query}"`);
  console.log(`Query words: ${queryWords.join(', ')}`);
  
  queryWords.forEach(word => {
    const regex = new RegExp('\\b' + word + '\\b', 'g');
    const textMatches = (textLower.match(regex) || []).length;
    
    const fileNameLower = fileName.toLowerCase();
    const fileNameMatches = (fileNameLower.match(regex) || []).length;
    
    const wordBoost = textMatches * 0.2 + fileNameMatches * 0.5;
    boost += wordBoost;
    
    if (wordBoost > 0) {
      console.log(`  "${word}": ${fileNameMatches} in filename, ${textMatches} in text = +${wordBoost.toFixed(2)}`);
    }
  });
  
  const wordsInFileName = queryWords.filter(word => 
    fileName.toLowerCase().includes(word)
  ).length;
  
  let multiWordBonus = 0;
  if (wordsInFileName >= 3) {
    multiWordBonus = 1.0;
  } else if (wordsInFileName >= 2) {
    multiWordBonus = 0.5;
  }
  
  if (multiWordBonus > 0) {
    console.log(`  Multi-word bonus (${wordsInFileName} words in filename): +${multiWordBonus}`);
  }
  
  boost += multiWordBonus;
  
  console.log(`  TOTAL BOOST: ${boost.toFixed(2)}`);
  return boost;
}

// Test cases
const fileName = "Milliseconds Matter Understanding Time in High-Speed Sports";
const sampleText = "In the world of motorsport, particularly Formula 1, performance is measured in milliseconds.";

console.log('='.repeat(80));
keywordBoost(sampleText, fileName, "Understanding Time in High-Speed Sports");
console.log('='.repeat(80));
keywordBoost(sampleText, fileName, "milliseconds");
console.log('='.repeat(80));
keywordBoost(sampleText, fileName, "Formula 1");
console.log('='.repeat(80));
keywordBoost(sampleText, fileName, "high speed sports");
