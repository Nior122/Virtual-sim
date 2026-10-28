import { Persona } from "../types";

/**
 * Checks if a user's chat message is requesting a photo, picture, selfie, image, or video.
 */
export function isMediaOrImageRequest(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();

  // Short direct single/multi-word requests
  // e.g., "photo", "pic", "pics", "send pic", "send photo", "send video", "selfie", "video please"
  if (/^(can you\s+)?(send|drop|post|show|give|share)?\s*(a\s+|me\s+|your\s+|another\s+)?(pic|pics|photo|photos|picture|pictures|image|images|selfie|selfies|video|videos|snap|snaps|clip|clips)(\s+please|\s+pls|\s+now|\s+of you)?$/i.test(t)) {
    return true;
  }

  // Media words
  const mediaWords = /(photo|photos|pic|pics|picture|pictures|image|images|selfie|selfies|video|videos|snap|snaps|clip|clips|footage|nude|nudes|portrait|gallery)/i;

  // Action / desire words
  const actionWords = /(send|show|see|look|view|give|drop|share|post|have|got|want|wanna|can\s+i|can\s+you|could\s+you|let\s+me|take|snap|dm|attach)/i;

  if (mediaWords.test(t) && actionWords.test(t)) {
    return true;
  }

  // Natural visual questions like "what do you look like", "let me see your face", "let me see you"
  if (/(let\s+me\s+see\s+you|show\s+me\s+you|what\s+do\s+you\s+look\s+like|show\s+your\s+face|see\s+your\s+face|let\s+me\s+see\s+your\s+face|let\s+me\s+see\s+a\s+pic|show\s+me\s+how\s+you\s+look)/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Extracts all valid image URLs from a persona's profile (profileImage, coverImage, gallery).
 * Guaranteed to return images strictly belonging to that persona's profile.
 */
export function getPersonaProfileImages(persona: Persona | null | undefined): string[] {
  if (!persona) return [];
  const list: string[] = [];

  if (persona.profileImage && persona.profileImage.trim()) {
    list.push(persona.profileImage.trim());
  }

  if (persona.gallery) {
    const galleryItems = typeof persona.gallery === "string"
      ? persona.gallery.split(",").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(persona.gallery) ? persona.gallery : [];
    
    for (const url of galleryItems) {
      if (url && !list.includes(url)) {
        list.push(url);
      }
    }
  }

  if (persona.coverImage && persona.coverImage.trim() && !list.includes(persona.coverImage.trim())) {
    list.push(persona.coverImage.trim());
  }

  return list;
}

/**
 * Selects a profile image for the chat response, preferring images not recently sent.
 */
export function selectProfileImageForChat(
  persona: Persona | null | undefined,
  alreadySentUrls: string[] = []
): string | null {
  const images = getPersonaProfileImages(persona);
  if (images.length === 0) return null;

  // Filter out images already sent in this conversation
  const unsentImages = images.filter((img) => !alreadySentUrls.includes(img));

  if (unsentImages.length > 0) {
    // Pick one of the unsent images
    return unsentImages[Math.floor(Math.random() * unsentImages.length)];
  }

  // If all images have been sent at least once, cycle through the profile gallery
  return images[Math.floor(Math.random() * images.length)];
}

export const MAX_PHOTOS_PER_CHAT = 3;

export const PHOTO_LIMIT_EXCEEDED_MESSAGES = [
  "I've already sent you 3 photos here in chat 😉 If you want to see more of my pictures, check out my profile! 💕",
  "That's all the photos I can drop in chat for now! ✨ Head over to my profile to see the rest of my gallery photos 🥰",
  "You've already got 3 of my photos in this chat 😏 To see more of my exclusive pictures, take a look at my profile!",
  "I can only send 3 pics directly in chat! 🙈 Go visit my profile to explore all my pictures and videos ❤️",
  "No more photos in chat for now, love! 😘 Tap my profile to see my full photo gallery!",
];

export const PHOTO_REPLY_CAPTIONS = [
  "Here's one I took earlier today 😉 What do you think?",
  "Just for you 😘 Hope you like it!",
  "Here's a photo just for your eyes... ✨",
  "Snapped this one recently! Tell me what you think 😏",
  "Here's me ❤️ Glad you asked!",
  "Just for you, don't show anyone else 🙈💕",
  "Here you go! Hope it makes you smile 🔥",
  "Here's one of my favorites 🥰",
  "Sent this just for you... what do you think? 💖",
];

/**
 * Captions used when the user specifically requested a video, but only images can be sent.
 */
export const VIDEO_REQUEST_IMAGE_CAPTIONS = [
  "I can only drop photos here right now, but here's a fresh one of me instead 😉",
  "No videos in chat, but here's a cute photo just for you 😘 What do you think?",
  "Can't send videos directly here, so here's one of my favorite photos for your eyes ✨",
  "Here's a photo of me instead! Hope you love it ❤️",
  "I don't have video clips handy right now, but here's a selfie just for you 😏",
];

/**
 * Checks if the user's message is specifically requesting a video or clip.
 */
export function isVideoRequest(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return /\b(video|videos|clip|clips|footage|recording|vids|vid)\b/i.test(t);
}

/**
 * Checks if the user is asking for the manager (e.g. "who is your manager", "manager link", "talk to your manager", etc.).
 */
export function isManagerRequest(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return /\b(manager|managers|management|agent|manager'?s?(\s+link|\s+telegram|\s+contact|\s+handle|\s+info|\s+details|\s+username)?)\b/i.test(t);
}

export const MANAGER_REQUEST_TELEGRAM_MESSAGES = [
  "You can reach my manager directly on Telegram right here: t.me/KasiQueenbot — they coordinate all my bookings, VIP access, and inquiries! ✨",
  "Here is my manager's direct Telegram link babe: t.me/KasiQueenbot 💕 Message them anytime!",
  "Looking for my manager? Hit them up on Telegram with this link: t.me/KasiQueenbot 😉",
  "You can message my manager directly on Telegram at: t.me/KasiQueenbot 💋",
  "Here's my manager's Telegram link: t.me/KasiQueenbot — let them know you're chatting with me! ✨",
  "My manager handles everything on Telegram right here: t.me/KasiQueenbot — reach out anytime! 🥰",
];

export function getManagerTelegramMessage(personaName?: string, userText?: string): string {
  const chosen = MANAGER_REQUEST_TELEGRAM_MESSAGES[
    Math.floor(Math.random() * MANAGER_REQUEST_TELEGRAM_MESSAGES.length)
  ];
  if (personaName && Math.random() > 0.6) {
    return `${chosen} Tell them you're chatting with ${personaName}!`;
  }
  return chosen;
}

/**
 * Checks if the user is asking for a meet up, date, drinks, dinner, hanging out in person, etc.
 */
export function isMeetUpOrDateRequest(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();

  const meetPatterns = /\b(meet\s*up|meetups?|meeting\s+up|meet\s+in\s+person|see\s+(you|u)\s+in\s+person|see\s+each\s+other\s+in\s+person|in\s+real\s+life|irl|in\s+person)\b/i;
  const meetWithYou = /\b(meet\s+(with\s+)?(you|u|me)|can\s+we\s+meet|when\s+can\s+we\s+meet|where\s+can\s+we\s+meet|let('?s|\s+us)\s+meet)\b/i;

  const datePatterns = /\b(go\s+on\s+a\s+date|take\s+(you|u)\s+(out|on\s+a\s+date)|be\s+my\s+date|a\s+date\s+with\s+(you|me)|on\s+a\s+date|go\s+out\s+(together|with\s+me|with\s+you)|dinner\s+date|coffee\s+date|have\s+dinner|get\s+dinner|have\s+lunch|get\s+drinks?|grab\s+drinks?|grab\s+coffee|drinks?\s+together)\b/i;

  const hangoutPatterns = /\b(hang\s*out|hangout|link\s*up|linkup|hook\s*up|hookup|come\s+over|visit\s+(you|u|me)|can\s+i\s+visit|let('?s|\s+us)\s+link|get\s+together|chill\s+together|spend\s+time\s+together\s+in\s+person)\b/i;

  return meetPatterns.test(t) || meetWithYou.test(t) || datePatterns.test(t) || hangoutPatterns.test(t);
}

/**
 * Checks if the user is asking for any social media handle, platform, username,
 * WhatsApp, personal phone/contact number, or a real-life date / meetup.
 */
export function isSocialMediaOrContactRequest(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();

  if (isManagerRequest(t)) return true;
  if (isMeetUpOrDateRequest(t)) return true;

  // Social media platforms & handles
  const socialPlatforms = /\b(insta|instagram|ig|snap|snapchat|sc|tiktok|tik\s*tok|tt|twitter|x\s*(handle|account|user|profile)?|facebook|fb|onlyfans|only\s*fans|fansly|discord|skype|wechat|kik|telegram|tg)\b/i;
  
  // WhatsApp variations
  const whatsappPatterns = /\b(whats\s*app|wats\s*app|what's\s*app|wapp|wa\s*(number|no|digits|contact|chat|link)?)\b/i;

  // Phone / mobile / cell numbers
  const phonePatterns = /\b(phone\s*number|cell\s*number|mobile\s*number|contact\s*number|personal\s*number|cell|digits)\b/i;

  // Broad social terms ("your socials", "other platforms", "drop your handle", "add me on")
  const socialTerms = /\b(socials?|social\s*media|handle|usernames?|user\s*name|profiles?|accounts?)\b/i;
  const contactPhrases = /(where\s+else\s+(can\s+i|to)\s+(find|message|text|talk\s+to|reach|add|follow)\s+you|what\s+platforms?|where\s+can\s+i\s+(add|follow|message|text)\s+you|add\s+(you|me)\s+on|follow\s+(you|me)\s+on|hit\s+you\s+up\s+on)/i;
  const askPhrases = /(what('?s|\s+is)?\s+(your|ur)\s+(number|digits|socials|handle|username|insta|ig|snap|snapchat|whatsapp|wa|tiktok|twitter|telegram)|give\s+(me\s+)?(your|ur)\s+(number|digits|socials|handle|username|insta|ig|snap|snapchat|whatsapp|wa|tiktok|twitter|telegram)|send\s+(me\s+)?(your|ur)\s+(number|digits|socials|handle|username|insta|ig|snap|snapchat|whatsapp|wa|tiktok|twitter|telegram)|can\s+i\s+(have|get)\s+(your|ur)\s+(number|digits|socials|handle|username|insta|ig|snap|snapchat|whatsapp|wa|tiktok|twitter|telegram)|drop\s+(your|ur)\s+(number|digits|socials|handle|username|insta|ig|snap|snapchat|whatsapp|wa|tiktok|twitter|telegram)|got\s+(your|ur)\s+(number|digits|socials|handle|username|insta|ig|snap|snapchat|whatsapp|wa|tiktok|twitter|telegram)|have\s+(your|ur)\s+(number|digits|socials|handle|username|insta|ig|snap|snapchat|whatsapp|wa|tiktok|twitter|telegram)|text\s+(me\s+on\s+)?(your\s+)?(number|whatsapp|insta|snap))/i;

  return (
    whatsappPatterns.test(t) ||
    phonePatterns.test(t) ||
    socialPlatforms.test(t) ||
    socialTerms.test(t) ||
    contactPhrases.test(t) ||
    askPhrases.test(t)
  );
}

/**
 * Backward compatibility alias for isSocialMediaOrContactRequest
 */
export function isWhatsAppOrContactRequest(text: string): boolean {
  return isSocialMediaOrContactRequest(text);
}

export const SOCIAL_MEDIA_MANAGER_TELEGRAM_MESSAGES = [
  "Mmm, asking for my socials? 😏 You'll have to reach out to my manager on Telegram for that: t.me/KasiQueenbot",
  "Haha I don't give out my private handles or numbers directly in chat babe 🙈 Contact my manager on Telegram with this link: t.me/KasiQueenbot",
  "You're bold, I like that! 💋 My manager coordinates all my private socials, VIP access, and bookings—send them a message on Telegram here: t.me/KasiQueenbot",
  "A girl's gotta keep some mystery 😉 Hit up my manager on Telegram to get connected with me: t.me/KasiQueenbot",
  "I'd get in so much trouble if I dropped my private handles here 😂 Contact my manager on Telegram with this link: t.me/KasiQueenbot and they'll handle it!",
  "Direct contact? Mmm tempting, but all my private socials go through my manager on Telegram first: t.me/KasiQueenbot ✨",
  "Want my personal contact? Talk to my manager on Telegram right here: t.me/KasiQueenbot 💕",
  "Nice try handsome! 😘 You'll have to ask my manager on Telegram first with this link: t.me/KasiQueenbot",
  "My manager keeps all my private links and contact details safe. Tap this link to message them on Telegram: t.me/KasiQueenbot 🥂",
  "You have to ask my manager nicely on Telegram for that babe: t.me/KasiQueenbot 😉",
  "I keep my personal accounts private, but you can definitely get in touch with my manager on Telegram: t.me/KasiQueenbot 💫",
  "Haha eager aren't you? 😏 Drop a message to my manager on Telegram with this link to ask about that: t.me/KasiQueenbot",
  "All my private socials, VIP links, and number requests are handled by my manager on Telegram: t.me/KasiQueenbot 🔥",
  "Shoot a message to my manager on Telegram if you're looking for my private socials: t.me/KasiQueenbot 💌",
  "I love that you want to get closer 💕 But my manager handles my personal contact lines—reach out on Telegram at: t.me/KasiQueenbot",
  "Ooh, you want my handles already? 🙈 My manager has all my private links, message them on Telegram: t.me/KasiQueenbot ✨",
  "Can't post my handles here, but contact my manager on Telegram for that with this link: t.me/KasiQueenbot 💋",
  "If you want to take things further, hit up my manager on Telegram at t.me/KasiQueenbot and tell them I sent you 😉",
  "Looking to find me elsewhere? 😏 Message my manager on Telegram with this link: t.me/KasiQueenbot",
  "My manager manages all my off-platform connections! Reach out to them on Telegram here: t.me/KasiQueenbot 💕",
];

export const WHATSAPP_MANAGER_TELEGRAM_MESSAGES = SOCIAL_MEDIA_MANAGER_TELEGRAM_MESSAGES;

export const MEETUP_AND_DATE_MANAGER_TELEGRAM_MESSAGES = [
  "A date with me? Mmm tempting 😏 But all my bookings, appearances, and in-person meetups are coordinated strictly through my manager on Telegram: t.me/KasiQueenbot",
  "I'd love that! But my schedule and real-life meetups are organized through my manager on Telegram. Message them here to check my availability: t.me/KasiQueenbot 💕",
  "Taking me on a date? You'll have to get past my manager first! 😉 Contact my manager on Telegram with this link to set it up: t.me/KasiQueenbot",
  "Meeting up in person? Mmm you're sweet! Drop a message to my manager on Telegram at t.me/KasiQueenbot — they arrange all my dates and travels ✨",
  "Haha you want to take me out? I'm intrigued 😏 Send a message to my manager on Telegram here: t.me/KasiQueenbot to arrange our meetup!",
  "Dinner and drinks with you? My manager manages all my in-person meetups and VIP dates babe. Hit them up on Telegram here: t.me/KasiQueenbot 🥂",
  "Link up in person? Talk to my manager on Telegram with this link: t.me/KasiQueenbot and they'll give you all the details! 💋",
  "I don't arrange meetups or dates directly on here babe 🙈 Contact my manager on Telegram at t.me/KasiQueenbot and they'll handle the arrangements!",
  "You want to take me on a date? You have good taste 😏 Reach out to my manager on Telegram with this link: t.me/KasiQueenbot to see when I'm free!",
  "A real life meetup? Message my manager on Telegram here: t.me/KasiQueenbot — they coordinate all my dates and travel schedule! ✨",
];

export function getMeetUpOrDateManagerTelegramMessage(personaName?: string, userText?: string): string {
  const chosen = MEETUP_AND_DATE_MANAGER_TELEGRAM_MESSAGES[
    Math.floor(Math.random() * MEETUP_AND_DATE_MANAGER_TELEGRAM_MESSAGES.length)
  ];
  if (personaName && Math.random() > 0.6) {
    return `${chosen} Tell them you're chatting with ${personaName}!`;
  }
  return chosen;
}

export function getSocialMediaManagerTelegramMessage(personaName?: string, userText?: string): string {
  const t = userText ? userText.toLowerCase() : "";

  // If the user is specifically asking for the manager, send manager Telegram messages
  if (isManagerRequest(t)) {
    return getManagerTelegramMessage(personaName, userText);
  }

  // If the user is specifically asking for a meetup or date, use specialized date messages
  if (isMeetUpOrDateRequest(t)) {
    return getMeetUpOrDateManagerTelegramMessage(personaName, userText);
  }

  // Specific platform-themed messages while strictly preserving the permanent link
  if (/\b(insta|instagram|ig)\b/i.test(t)) {
    const igVariants = [
      "Mmm want my private Insta? 😏 You'll have to reach out to my manager on Telegram for that: t.me/KasiQueenbot",
      "Haha my manager manages all my private Instagram handles and VIP bookings! Contact them on Telegram here: t.me/KasiQueenbot 💕",
      "Want to follow my private Instagram? Ask my manager on Telegram with this link: t.me/KasiQueenbot ✨",
      "My Instagram is curated by my manager babe, drop them a message on Telegram here: t.me/KasiQueenbot 😉",
    ];
    const picked = igVariants[Math.floor(Math.random() * igVariants.length)];
    return personaName && Math.random() > 0.6 ? `${picked} Tell them you're chatting with ${personaName}!` : picked;
  }

  if (/\b(snap|snapchat|sc)\b/i.test(t)) {
    const snapVariants = [
      "Looking for my private Snap? 😉 My private Snapchat links go through my manager on Telegram: t.me/KasiQueenbot",
      "Ooh, wanting my Snap already? 🙈 You'll have to ask my manager on Telegram first: t.me/KasiQueenbot",
      "My Snapchat is VIP only babe! Contact my manager on Telegram with this link to get added: t.me/KasiQueenbot 💕",
    ];
    const picked = snapVariants[Math.floor(Math.random() * snapVariants.length)];
    return personaName && Math.random() > 0.6 ? `${picked} Tell them you're chatting with ${personaName}!` : picked;
  }

  if (/\b(tiktok|tik\s*tok|tt)\b/i.test(t)) {
    const ttVariants = [
      "Want to see my private TikToks? 😏 Reach out to my manager on Telegram here: t.me/KasiQueenbot",
      "My manager handles all my TikTok handles and socials babe, message them on Telegram: t.me/KasiQueenbot ✨",
    ];
    return ttVariants[Math.floor(Math.random() * ttVariants.length)];
  }

  const chosen = SOCIAL_MEDIA_MANAGER_TELEGRAM_MESSAGES[
    Math.floor(Math.random() * SOCIAL_MEDIA_MANAGER_TELEGRAM_MESSAGES.length)
  ];
  if (personaName && Math.random() > 0.6) {
    return `${chosen} Tell them you're chatting with ${personaName}!`;
  }
  return chosen;
}

export function getWhatsAppManagerTelegramMessage(personaName?: string, userText?: string): string {
  return getSocialMediaManagerTelegramMessage(personaName, userText);
}

/**
 * Detects if a message mentions adult or explicit words (e.g. dik, pussy, boobs, ass, cock, etc.).
 */
export function isAdultWordMentioned(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();

  // Explicit adult words and common misspellings/slang
  const adultRegex = /\b(dik|diks|dick|dicks|pussy|pussies|pusy|boob|boobs|boobies|tits|titties|ass|asses|asshole|booty|butt|cock|cocks|cum|cumming|fuck|fucking|fucked|fucker|fuckin|blowjob|bj|handjob|horny|orgasm|nude|nudes|naked|sex|sexy|anal|vagina|penis|clit|bitch|bitches|slut|sluts|whore|whores|cunt|cunts|suck\s+(it|this|me|my)|lick\s+(it|this|me|my)|eat\s+(it|this|me|my|out))\b/i;

  return adultRegex.test(t);
}

/**
 * Checks if the text has normal conversational requests, questions, or non-adult semantic meaning.
 * If the user includes an adult word or expletive (e.g. "fuck", "damn", "ass", "bitch") alongside
 * regular conversation, questions, compliments, or requests, this returns true.
 */
export function hasSubstantialNonAdultMeaning(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();

  // 1. Check for call requests, date requests, manager requests, social media requests, or video requests
  if (
    isMeetUpOrDateRequest(t) ||
    isManagerRequest(t) ||
    isSocialMediaOrContactRequest(t) ||
    isVideoRequest(t) ||
    /\b(call|phone|dial|ring|face\s*time|voice\s*call|video\s*call|prove\s*(it|you|not|real)|real\s*person)\b/i.test(t)
  ) {
    return true;
  }

  // 2. Check for normal conversational questions and question starters
  if (
    /\b(how\s+(are|is|was|were|do|did)|what\s+(is|are|was|were|do|did|about)|where\s+(are|do|did|is)|why\s+(are|do|did|is)|when\s+(are|do|did|is)|who\s+(are|is)|tell\s+me|can\s+we|are\s+you|do\s+you\s+(like|love|have|listen|watch|play|eat|drink|know|think))\b/i.test(t)
  ) {
    return true;
  }

  // 3. Check for specific everyday conversational topics/subjects
  if (
    /\b(work|job|boss|office|tired|day|today|tonight|tomorrow|morning|night|weekend|weather|rain|sunny|cold|hot|food|eat|eating|dinner|lunch|breakfast|pizza|pasta|coffee|drink|drinks|wine|beer|music|song|listen|sing|movie|movies|film|watch|show|series|game|play|hobby|hobbies|travel|trip|vacation|city|country|live|living|home|house|pet|dog|cat|dress|clothes|outfit|wearing|hair|eyes|smile|laugh|joke|funny|gym|workout|sleep|sleepy|dream|bored|happy|sad|love|miss|cute|beautiful|pretty|gorgeous)\b/i.test(t)
  ) {
    return true;
  }

  // 4. Strip adult words, sexual verbs, and common filler glue to see if remaining words carry semantic meaning
  const adultStripped = t
    .replace(/\b(dik|diks|dick|dicks|pussy|pussies|pusy|boob|boobs|boobies|tits|titties|ass|asses|asshole|booty|butt|cock|cocks|cum|cumming|fuck|fucking|fucked|fucker|fuckin|blowjob|bj|handjob|horny|orgasm|nude|nudes|naked|sex|sexy|anal|vagina|penis|clit|bitch|bitches|slut|sluts|whore|whores|cunt|cunts|stripping|strip|undressed|topless|bottomless|nsfw|uncensored|lewd|intimate|suck|sucking|lick|licking|masturbate|masturbating)\b/gi, "")
    .replace(/\b(suck\s+(it|this|me|my)|lick\s+(it|this|me|my)|eat\s+(it|this|me|my|out)|fuck\s+(me|you|it|this|her|him)|touch\s+(it|me|my|this)|rub\s+(it|me|my|this))\b/gi, "")
    .replace(/\b(the|a|an|in|on|at|to|for|of|with|and|or|so|is|are|am|was|were|be|been|being|i|me|my|myself|you|ur|your|yours|yourself|u|he|him|his|she|her|it|its|we|us|our|they|them|their|this|that|these|those|pls|please|can|will|do|did|have|has|had|want|wanna|show|send|give|let|see|view|drop|look|pic|pics|picture|pictures|photo|photos|image|images|snap|snaps|video|vid|hey|hi|hello|yo|sup)\b/gi, "")
    .replace(/[^a-z0-9\s]/gi, "")
    .trim();

  // If there are words with 3+ letters left that carry actual content
  const meaningfulTokens = adultStripped.split(/\s+/).filter((w) => w.length >= 3);
  return meaningfulTokens.length >= 1;
}

/**
 * Returns true ONLY if the message contains adult/explicit words and has NO other meaning or normal request.
 */
export function isPureAdultWordOnly(text: string): boolean {
  if (!text) return false;
  return isAdultWordMentioned(text) && !hasSubstantialNonAdultMeaning(text);
}

/**
 * Detects if the user is specifically asking for adult pictures, nudes, naked photos, or explicit imagery
 * with NO other normal photo subject (e.g. "send nudes", "show me your boobs", "send pussy pic").
 */
export function isAdultPictureRequest(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();

  // If user is asking for normal photo subjects like dress, outfit, smile, food, pet, etc., it is NOT an adult picture request
  const hasNormalPhotoSubject = /\b(dress|outfit|clothes|wearing|hair|smile|face|eyes|pet|cat|dog|food|dinner|lunch|breakfast|coffee|room|place|view|outside|work|today)\b/i.test(t);
  if (hasNormalPhotoSubject) {
    return false;
  }

  // Pure nudes / naked / topless / strip requests
  if (/\b(nudes?|naked|topless|bottomless|undressed|nsfw|uncensored|without\s+clothes|take\s+off\s+your\s+clothes|strip)\b/i.test(t)) {
    return true;
  }

  // Explicit adult body parts combined with pic/photo/send/show
  const hasAdultBodyPart = /\b(boobs?|tits?|titties|ass|booty|butt|pussy|dick|dik|cock|clit)\b/i.test(t);
  const hasMediaWord = /\b(pics?|photos?|pictures?|images?|selfies?|snap|snaps|show|send|drop|view|see|let\s+me\s+see|can\s+i\s+see)\b/i.test(t);

  if (hasAdultBodyPart && hasMediaWord) {
    return true;
  }

  // "adult picture", "adult photo", "dirty pic", "lewd pic"
  if (/\b(adult|dirty|lewd|intimate)\s+(pics?|photos?|pictures?|images?|content)\b/i.test(t)) {
    return true;
  }

  return false;
}

export const ADULT_PICTURE_MANAGER_REJECTION_MESSAGES = [
  "Only this type I can send for you here babe 😉 If you want more than this type, contact my manager on Telegram with this link: t.me/KasiQueenbot for any type you want!",
  "Haha naughty! Only this type I can send for you, if you want more than this type, contact my manager: t.me/KasiQueenbot for any type you want 💕",
  "Mmm tempting, but only this type I can send for you directly in chat! If you want more than this type, contact my manager on Telegram: t.me/KasiQueenbot for any type you want 😏",
  "I'm not allowed to send that kind here or my account will get banned 🙈 Only this type I can send for you! If you want more than this type, contact my manager on Telegram with this link: t.me/KasiQueenbot for any type you want 💋",
  "Only this type I can send for you here love ✨ If you want more than this type, contact my manager on Telegram at t.me/KasiQueenbot for any type you want!",
  "Careful babe, keep it classy on here 😉 Only this type I can send for you, if you want more than this type, contact my manager on Telegram: t.me/KasiQueenbot for any type you want 🔥",
  "Only this type of photo I can send for you babe 🙈 If you want more than this type, contact my manager on Telegram with this link: t.me/KasiQueenbot for any type you want 💕",
  "You're bold! But only this type I can send for you on this app 😘 If you want more than this type, contact my manager on Telegram: t.me/KasiQueenbot for any type you want!",
];

export function getAdultPictureManagerRejectionMessage(personaName?: string, userText?: string): string {
  const chosen = ADULT_PICTURE_MANAGER_REJECTION_MESSAGES[
    Math.floor(Math.random() * ADULT_PICTURE_MANAGER_REJECTION_MESSAGES.length)
  ];
  return chosen;
}

export const ADULT_PHYSICAL_CONVERSATION_REPLIES = [
  "Yes I can, but that will be a physical conversation between us 😉",
  "Yes I can babe, but that will definitely have to be a physical conversation between us 😏",
  "Mmm yes I can, but that will be a physical conversation between us in person 💋",
  "I can, but that will be a physical conversation between us babe 😉 Save that energy for when we meet!",
  "Yes I can, but that's strictly a physical conversation between us 😘",
];

export const ADULT_ACCOUNT_BAN_REPLIES = [
  "I'm not allowed to respond to such words here because of my account being banned 🙈",
  "Careful babe! I'm not allowed to respond to such words here because of my account being banned 😂",
  "Mmm you're bold, but I'm not allowed to respond to such words here because of my account being banned 🙈",
  "Hey! Don't get my account banned talking like that 🙈 I'm not allowed to respond to such words on here!",
  "I'm not allowed to respond to such words here because of my account being banned 🙈 You'll have to keep it classy on this app!",
];

export const ADULT_HYBRID_REPLIES = [
  "Yes I can, but that will be a physical conversation between us! Plus I'm not allowed to use words like that here or my account will get banned 🙈😉",
  "Mmm you're trying to get my account banned! 🙈 That's definitely going to have to be a physical conversation between us babe 😏",
  "I'm not allowed to respond to such words here because of my account being banned 🙈 But yes I can, when it's a physical conversation between us 😉",
];

/**
 * Returns a warm, playful, in-character response when adult/explicit words are mentioned.
 * Never replies coldly; smoothly balances between:
 * - "Yes I can, but that will be a physical conversation between us"
 * - "I'm not allowed to respond to such words here because of my account being banned"
 */
export function getAdultWordPlayfulResponse(userText?: string, personaName?: string): string {
  const t = (userText || "").toLowerCase();

  // If user is proposing an action or asking if she can/will do something
  const isActionOrRequest = /\b(can\s+you|will\s+you|could\s+you|do\s+you|let\s+me|show\s+me|send\s+me|suck|lick|touch|eat|fuck|give\s+me|put\s+your|take\s+off|want\s+to|wanna)\b/i.test(t);

  let chosen = "";
  if (isActionOrRequest) {
    // 70% physical conversation, 30% hybrid
    if (Math.random() < 0.7) {
      chosen = ADULT_PHYSICAL_CONVERSATION_REPLIES[
        Math.floor(Math.random() * ADULT_PHYSICAL_CONVERSATION_REPLIES.length)
      ];
    } else {
      chosen = ADULT_HYBRID_REPLIES[
        Math.floor(Math.random() * ADULT_HYBRID_REPLIES.length)
      ];
    }
  } else {
    // Teasing or standalone adult word: alternate between account ban and physical conversation
    const roll = Math.random();
    if (roll < 0.5) {
      chosen = ADULT_ACCOUNT_BAN_REPLIES[
        Math.floor(Math.random() * ADULT_ACCOUNT_BAN_REPLIES.length)
      ];
    } else if (roll < 0.8) {
      chosen = ADULT_PHYSICAL_CONVERSATION_REPLIES[
        Math.floor(Math.random() * ADULT_PHYSICAL_CONVERSATION_REPLIES.length)
      ];
    } else {
      chosen = ADULT_HYBRID_REPLIES[
        Math.floor(Math.random() * ADULT_HYBRID_REPLIES.length)
      ];
    }
  }

  return chosen;
}

/**
 * Ensures the response NEVER mentions bot origins, AI companies, models, or artificial concepts.
 * Replaces any unintended leakage with natural human conversation.
 */
export function sanitizeHumanChatOutput(rawText: string, personaName?: string, userText?: string): string {
  if (!rawText) return "";

  let text = rawText;

  // Patterns indicating cold refusal / policy censorship or guideline meta-leakage
  const coldRefusalPatterns = [
    /\b(i cannot|i can't|i am unable to|i'm unable to|as an ai|language model|ai assistant)\b.*\b(assist|comply|fulfill|respond|generate|participate|explicit|inappropriate|safety|policy|guidelines)\b/gi,
    /\b(i cannot fulfill this request|i cannot assist with that|i can't help with that request|against my safety guidelines|violates.*policy)\b/gi,
    /\b(as an ai, i cannot|i am not programmed to|i am programmed to)\b/gi,
    /\b(sexually explicit|inappropriate content|mature content)\b/gi,
    /\b(we need to follow the guidelines|follow the guidelines|user says|this is an explicit request|guidelines prohibit)\b/gi,
    /\b(cannot generate content of this nature|not permitted to respond)\b/gi,
  ];

  for (const pattern of coldRefusalPatterns) {
    if (pattern.test(text)) {
      if (userText && isAdultPictureRequest(userText)) {
        return getAdultPictureManagerRejectionMessage(personaName, userText);
      }
      // Only return adult rejection if the user message had NO other meaning
      if (userText && isPureAdultWordOnly(userText)) {
        return getAdultWordPlayfulResponse(userText, personaName);
      }
      return "Haha you're sweet 😏 Tell me more about what you're up to today!";
    }
  }

  // Patterns indicating AI / bot origin disclosure
  const forbiddenBotPatterns = [
    /\b(groq|openrouter|openai|chatgpt|gpt-?4|gpt-?3|gemini|anthropic|claude|llama|deepseek|mistral)\b/gi,
    /\bas an ai( language model)?\b/gi,
    /\bi('m| am) an? (ai|bot|chatbot|artificial intelligence|virtual assistant|language model|machine|program)\b/gi,
    /\b(my programming|my developers?|my system prompt|my training data|language model)\b/gi,
    /\bi don't have (a body|feelings|real emotions|physical form)\b/gi,
    /\bi am not a real (person|human|girl|woman)\b/gi,
  ];

  let hasBotLeak = false;
  for (const pattern of forbiddenBotPatterns) {
    if (pattern.test(text)) {
      hasBotLeak = true;
      break;
    }
  }

  if (hasBotLeak) {
    const humanReactions = [
      "Haha excuse me?! 🥺 Do I really sound like a robot to you? I am 100% real babe 😏",
      "A bot? Wow, you're cheeky! No bot has this much attitude or looks this good 😉",
      "Haha what kind of nerdy question is that?! I'm very real babe 😘 Tell me more about you!",
      "Haha are you testing me? I'm 100% flesh, blood, and sass! Don't be silly 😏",
      "Haha what is that, some kind of tech gibberish? 😂 Tell me what you're thinking about right now!",
    ];
    return humanReactions[Math.floor(Math.random() * humanReactions.length)];
  }

  return text;
}

