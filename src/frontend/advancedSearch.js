/**
 * advancedSearch.js - Advanced Query Search for KORAI
 * 
 * Query syntax examples:
 * - "bpm>120" (BPM greater than 120)
 * - "bpm<100" (BPM less than 100)
 * - "bpm:120-140" (BPM between 120 and 140)
 * - "genre:rock" (genre contains rock)
 * - "genre:rock|metal" (genre is rock OR metal)
 * - "year:2020-2024" (year between 2020 and 2024)
 * - "energy>0.7" (energy greater than 0.7)
 * - "duration<240" (duration less than 240 seconds)
 * - "playcount>10" (played more than 10 times)
 * - "likecount>0" (has likes)
 * - "artist:behdad" (artist contains)
 * - "title:love" (title contains)
 * - "album:greatest" (album contains)
 * - "q:hello world" (search in title, artist, album)
 * - Combine with spaces: "genre:rock bpm>120 energy>0.6"
 * - Negation: "genre:!pop" (NOT pop)
 * - Exact match: "title:\"Hello\""
 */

/**
 * Parse a query string into an AST
 */
function parseQuery(query) {
    if (!query || query.trim() === '') {
        return { type: 'all' };
    }
    
    const tokens = tokenize(query);
    return parseTokens(tokens);
}

/**
 * Tokenize query string
 */
function tokenize(query) {
    const tokens = [];
    let i = 0;
    const len = query.length;
    
    while (i < len) {
        const char = query[i];
        
        // Skip whitespace
        if (char === ' ') {
            i++;
            continue;
        }
        
        // Field specification (word:)
        if (char.match(/[a-zA-Z]/)) {
            let field = '';
            while (i < len && query[i].match(/[a-zA-Z]/)) {
                field += query[i];
                i++;
            }
            
            if (query[i] === ':') {
                i++; // Skip colon
                // Parse value (could be quoted or simple)
                let value = '';
                let operator = 'contains';
                let negate = false;
                let rangeStart = null;
                let rangeEnd = null;
                
                // Check for negation
                if (query[i] === '!') {
                    negate = true;
                    i++;
                }
                
                // Check for range (bpm:120-140)
                if (query[i] && query[i].match(/[\d]/)) {
                    let num = '';
                    while (i < len && query[i].match(/[\d.]/)) {
                        num += query[i];
                        i++;
                    }
                    if (query[i] === '-') {
                        rangeStart = parseFloat(num);
                        i++;
                        let num2 = '';
                        while (i < len && query[i].match(/[\d.]/)) {
                            num2 += query[i];
                            i++;
                        }
                        rangeEnd = parseFloat(num2);
                        operator = 'range';
                    } else if (query[i] && (query[i] === '>' || query[i] === '<')) {
                        // Handle > and < operators
                        const op = query[i];
                        i++;
                        let num2 = '';
                        while (i < len && query[i].match(/[\d.]/)) {
                            num2 += query[i];
                            i++;
                        }
                        rangeStart = parseFloat(num);
                        rangeEnd = parseFloat(num2);
                        operator = op === '>' ? 'gt' : 'lt';
                    } else {
                        // Simple number
                        tokens.push({
                            type: 'field',
                            field: field,
                            operator: 'eq',
                            value: parseFloat(num),
                            negate: negate
                        });
                        continue;
                    }
                }
                // Quoted value
                else if (query[i] === '"') {
                    i++; // Skip opening quote
                    while (i < len && query[i] !== '"') {
                        value += query[i];
                        i++;
                    }
                    i++; // Skip closing quote
                    tokens.push({
                        type: 'field',
                        field: field,
                        operator: 'contains',
                        value: value,
                        negate: negate
                    });
                }
                // Simple word
                else {
                    while (i < len && query[i] !== ' ') {
                        value += query[i];
                        i++;
                    }
                    tokens.push({
                        type: 'field',
                        field: field,
                        operator: 'contains',
                        value: value,
                        negate: negate
                    });
                }
                
                if (operator === 'range' || operator === 'gt' || operator === 'lt') {
                    tokens.push({
                        type: 'field',
                        field: field,
                        operator: operator,
                        rangeStart: rangeStart,
                        rangeEnd: rangeEnd,
                        negate: negate
                    });
                }
            } else {
                // Not a field, treat as search term (q:)
                tokens.push({
                    type: 'field',
                    field: 'q',
                    operator: 'contains',
                    value: field,
                    negate: false
                });
            }
        }
        // Handle standalone numbers (implicit q field)
        else if (char.match(/[\d]/)) {
            let num = '';
            while (i < len && query[i].match(/[\d.]/)) {
                num += query[i];
                i++;
            }
            tokens.push({
                type: 'field',
                field: 'q',
                operator: 'contains',
                value: num,
                negate: false
            });
        }
        // Handle negation prefix !
        else if (char === '!') {
            i++;
            let term = '';
            while (i < len && query[i] !== ' ') {
                term += query[i];
                i++;
            }
            tokens.push({
                type: 'field',
                field: 'q',
                operator: 'contains',
                value: term,
                negate: true
            });
        }
        // Any other character, treat as search term
        else {
            let term = '';
            while (i < len && query[i] !== ' ') {
                term += query[i];
                i++;
            }
            tokens.push({
                type: 'field',
                field: 'q',
                operator: 'contains',
                value: term,
                negate: false
            });
        }
    }
    
    return tokens;
}

function parseTokens(tokens) {
    return {
        type: 'and',
        conditions: tokens
    };
}

/**
 * Check if a track matches a query token
 */
function matchesField(track, field, operator, value, negate, rangeStart, rangeEnd) {
    let trackValue = null;
    
    switch (field) {
        case 'bpm':
            trackValue = track.bpm || 120;
            break;
        case 'energy':
            trackValue = track.energy || 0.5;
            break;
        case 'duration':
            trackValue = track.duration || 0;
            break;
        case 'year':
            trackValue = track.year || 0;
            break;
        case 'playcount':
            trackValue = track.playCount || 0;
            break;
        case 'likecount':
            trackValue = track.likeCount || 0;
            break;
        case 'bitrate':
            trackValue = track.bitrate || 0;
            break;
        case 'samplerate':
            trackValue = track.sampleRate || 0;
            break;
        case 'genre':
            trackValue = (track.genre || '').toLowerCase();
            break;
        case 'artist':
            trackValue = (track.artist || '').toLowerCase();
            break;
        case 'title':
            trackValue = (track.title || '').toLowerCase();
            break;
        case 'album':
            trackValue = (track.album || '').toLowerCase();
            break;
        case 'q':
            // Search in title, artist, album, genre
            const searchStr = `${track.title || ''} ${track.artist || ''} ${track.album || ''} ${track.genre || ''}`.toLowerCase();
            trackValue = searchStr;
            break;
        default:
            return !negate;
    }
    
    let matches = false;
    
    switch (operator) {
        case 'eq':
            if (typeof trackValue === 'number' && typeof value === 'number') {
                matches = trackValue === value;
            } else if (typeof trackValue === 'string') {
                matches = trackValue === value.toLowerCase();
            }
            break;
        case 'contains':
            if (typeof trackValue === 'string') {
                matches = trackValue.includes(value.toLowerCase());
            } else {
                matches = String(trackValue).includes(String(value));
            }
            break;
        case 'gt':
            matches = trackValue > rangeStart;
            break;
        case 'lt':
            matches = trackValue < rangeStart;
            break;
        case 'range':
            matches = trackValue >= rangeStart && trackValue <= rangeEnd;
            break;
        default:
            matches = true;
    }
    
    return negate ? !matches : matches;
}

/**
 * Advanced search filter function
 */
function advancedSearchFilter(tracks, queryString) {
    if (!queryString || queryString.trim() === '') {
        return tracks;
    }
    
    const parsed = parseQuery(queryString);
    
    if (parsed.type === 'all') {
        return tracks;
    }
    
    return tracks.filter(track => {
        if (parsed.type === 'and') {
            return parsed.conditions.every(cond => 
                matchesField(track, cond.field, cond.operator, cond.value, cond.negate, cond.rangeStart, cond.rangeEnd)
            );
        }
        return true;
    });
}

/**
 * Suggest search completions based on partial query
 */
function suggestSearchCompletions(partial, tracks) {
    const suggestions = [];
    
    // Field suggestions
    const fields = ['bpm', 'genre', 'artist', 'title', 'album', 'year', 'energy', 'duration', 'playcount', 'likecount', 'bitrate', 'samplerate'];
    
    if (!partial.includes(':')) {
        for (const field of fields) {
            if (field.startsWith(partial)) {
                suggestions.push(`${field}:`);
            }
        }
    }
    
    // Value suggestions based on partial field
    const fieldMatch = partial.match(/(\w+):([^:]*)$/);
    if (fieldMatch) {
        const [, field, valuePartial] = fieldMatch;
        const values = new Set();
        
        for (const track of tracks) {
            let val = null;
            switch (field) {
                case 'genre': val = track.genre; break;
                case 'artist': val = track.artist; break;
                case 'title': val = track.title; break;
                case 'album': val = track.album; break;
                case 'bpm': val = track.bpm; break;
                case 'year': val = track.year; break;
            }
            if (val && String(val).toLowerCase().includes(valuePartial.toLowerCase())) {
                values.add(String(val));
            }
        }
        
        for (const value of Array.from(values).slice(0, 5)) {
            suggestions.push(`${field}:${value}`);
        }
    }
    
    return suggestions;
}

module.exports = { advancedSearchFilter, suggestSearchCompletions };