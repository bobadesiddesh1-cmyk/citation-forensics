/**
 * CiteTrace stoplist — exactly 200 common English words (normalized form:
 * lowercase, apostrophes removed, e.g. "dont" not "don't").
 * A token NOT in this set counts as "rare" for the paraphrase tier's
 * shared-rare-token test (see content/matcher.js).
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.STOPLIST) return;

  NS.STOPLIST = new Set([
    "a", "about", "above", "after", "again", "against", "all", "also", "am",
    "among", "an", "and", "any", "are", "arent", "as", "at", "be", "because",
    "been", "before", "being", "below", "between", "both", "but", "by",
    "can", "cannot", "cant", "come", "could", "did", "didnt", "different",
    "do", "does", "doesnt", "doing", "dont", "down", "during", "each",
    "even", "few", "first", "for", "found", "from", "further", "get", "gets",
    "give", "good", "got", "had", "has", "have", "having", "he", "her",
    "here", "hers", "herself", "high", "him", "himself", "his", "how",
    "however", "i", "if", "in", "including", "into", "is", "isnt", "it",
    "its", "itself", "just", "know", "last", "like", "long", "made", "make",
    "makes", "many", "may", "me", "might", "more", "most", "much", "must",
    "my", "myself", "need", "new", "no", "nor", "not", "now", "of", "off",
    "on", "once", "one", "only", "or", "other", "others", "our", "ours",
    "ourselves", "out", "over", "own", "part", "per", "put", "said", "same",
    "say", "says", "see", "she", "should", "shouldnt", "since", "so", "some",
    "still", "such", "take", "than", "that", "thats", "the", "their",
    "theirs", "them", "themselves", "then", "there", "theres", "these",
    "they", "this", "those", "though", "through", "thus", "time", "to",
    "too", "two", "under", "until", "up", "upon", "us", "use", "used",
    "uses", "using", "very", "want", "was", "wasnt", "way", "we", "well",
    "went", "were", "werent", "what", "when", "where", "whether", "which",
    "while", "who", "whom", "whose", "why", "will", "with", "within",
    "without", "wont", "would", "wouldnt", "yet", "you", "your", "yours",
    "yourself", "yourselves",
  ]);
})();
