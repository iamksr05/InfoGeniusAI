console.log("🔥 Script loaded");
import user from "./assets/user-icon.svg";
import { parse } from "marked";



// Get AI logo path - works for both local and hosted environments
function getAILogoPath() {
  // Strategy 1: Check if hero logo exists and use same path
  const heroLogo = document.querySelector('#hero-section .hero-logo');
  if (heroLogo && heroLogo.src) {
    try {
      const heroURL = new URL(heroLogo.src);
      // If hero logo is loaded successfully, use the same base path
      if (heroLogo.complete && heroLogo.naturalWidth > 0) {
        const heroPath = heroLogo.getAttribute('src');
        console.log('AI Logo path (from hero logo):', heroPath);
        return heroPath;
      }
    } catch (e) {
      // Continue to other strategies
    }
  }

  // Strategy 2: If we're in a subdirectory like /client/, use absolute path
  const pathname = window.location.pathname;
  if (pathname.includes('/client/')) {
    const absolutePath = '/client/AI_logo.png';
    console.log('AI Logo path (subdirectory):', absolutePath);
    return absolutePath;
  }

  // Strategy 3: Try to get from script location (most reliable)
  const scripts = Array.from(document.getElementsByTagName('script'));
  const moduleScript = scripts.find(s => s.type === 'module' && s.src);

  if (moduleScript && moduleScript.src) {
    try {
      const scriptURL = new URL(moduleScript.src, window.location.href);
      const scriptDir = scriptURL.pathname.substring(0, scriptURL.pathname.lastIndexOf('/') + 1);
      const logoPath = scriptDir + 'AI_logo.png';
      console.log('AI Logo path (from script):', logoPath);
      return logoPath;
    } catch (e) {
      console.warn('Error resolving script path:', e);
    }
  }

  // Strategy 4: Use relative path from current page
  const currentDir = pathname.endsWith('/')
    ? pathname
    : pathname.substring(0, pathname.lastIndexOf('/') + 1);
  const relativePath = currentDir + 'AI_logo.png';
  console.log('AI Logo path (relative):', relativePath);
  return relativePath;
}

const AI_LOGO_PATH = getAILogoPath();

const form = document.querySelector("form");
const chatContainer = document.querySelector("#chat_container");
const sendButton = document.getElementById("sendButton");
const sendIcon = document.getElementById("sendIcon");
const themeBtn = document.getElementById("theme-btn");
const modelToggle = document.getElementById("model-toggle");
const modelStatusLabel = document.getElementById("model-2-status");
const toggleContainer = document.querySelector(".toggle-container");
const promptInput = document.getElementById("prompt");

let loadInterval;
let lastRequestTime = 0;

// Generate a session ID once per page load - maintains history during session, clears on refresh
// This is generated once when the script loads, so all requests in the same page session use the same ID
const currentSessionId = `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;

function getSessionId() {
  // Return the session ID generated at page load
  // This ensures:
  // - History is maintained during the current session (same ID for all requests)
  // - Memory is cleared on page refresh (new ID generated on each page load)
  return currentSessionId;
}

// Function to create the typing loader animation
function loader(element) {
  element.innerHTML = `
    <span class="thinking-indicator">
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
    </span>
  `;
}

// Function to format code blocks with copy button
function formatCodeBlocks(text) {
  // Match code blocks with ```language or ``` - improved regex
  // Handles: ```language\ncode``` or ```\ncode``` or ```language code```
  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;

  return text.replace(codeBlockRegex, (match, lang, code) => {
    const language = (lang || 'text').trim().toLowerCase();
    const codeId = `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Only format if we have actual code content
    if (code.trim().length === 0) {
      return match; // Return original if empty
    }

    // Split code into lines and process each line
    const codeLines = code.trimEnd().split('\n');
    const lineCount = codeLines.length;

    // Generate line numbers - one per line
    let lineNumbersHTML = '';
    for (let i = 1; i <= lineCount; i++) {
      lineNumbersHTML += `<span class="line-number">${i}</span>\n`;
    }

    // Escape each line separately
    const escapedCode = codeLines.map(line => escapeHtml(line)).join('\n');

    return '<div class="code-block-container">' +
      '<div class="code-header">' +
      '<span class="code-language">' + language + '</span>' +
      '<button class="copy-code-btn" data-code-id="' + codeId + '" title="Copy code">' +
      '<span class="material-icons-round copy-icon">content_copy</span>' +
      '<span class="copy-text">Copy</span>' +
      '</button>' +
      '</div>' +
      '<div class="code-wrapper">' +
      '<div class="line-numbers" aria-hidden="true">' + lineNumbersHTML.trim() + '</div>' +
      '<pre class="code-block"><code id="' + codeId + '" class="language-' + language + '">' + escapedCode + '</code></pre>' +
      '</div>' +
      '</div>';
  });
}

// Function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Function to format user messages - preserve line breaks and escape HTML
function formatUserMessage(text) {
  if (!text) return '';
  // Escape HTML to prevent XSS
  const escaped = escapeHtml(text);
  // Convert line breaks to <br> tags
  return escaped.replace(/\n/g, '<br>');
}

// Function to format inline code
function formatInlineCode(text) {
  // Match inline code with `code`
  const inlineCodeRegex = /`([^`\n]+)`/g;
  return text.replace(inlineCodeRegex, '<code class="inline-code">$1</code>');
}

// Function to format links (ensure they're clickable)
function formatLinks(text) {
  let out = text;

  // Convert Markdown links: [text](url)
  const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  out = out.replace(
    mdLinkRegex,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="message-link">$1</a>'
  );

  // Match plain URLs
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
  out = out.replace(
    urlRegex,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="message-link">$1</a>'
  );

  return out;
}

// Function to process and format the message content
function processMessageContent(text) {
  let processed = text;

  // First, format code blocks (before inline code to avoid conflicts)
  processed = formatCodeBlocks(processed);

  // Then format inline code
  processed = formatInlineCode(processed);

  // Format links
  processed = formatLinks(processed);

  // Convert line breaks to <br>
  processed = processed.replace(/(?![^<]*<\/pre>)\n/g, '<br>');
  return processed;
}

// Function to simulate typing animation for bot responses
// Function to simulate typing animation for bot responses
function typeText(element, text) {
  element.innerHTML = ""; // Clear the content before typing

  // Split text by code blocks
  // Matches: ```language\ncode``` or ```\ncode``` or ```language code```
  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  const rawParts = [];
  let lastIndex = 0;
  let match;
  const codeBlocks = [];

  // Find all code blocks
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const language = (match[1] || 'text').trim().toLowerCase();
    const code = match[2].trim();

    if (code.length > 0) {
      codeBlocks.push({
        start: match.index,
        end: match.index + match[0].length,
        language: language,
        code: code
      });
    }
  }

  // Build raw parts array
  if (codeBlocks.length === 0) {
    rawParts.push({ type: 'text', content: text });
  } else {
    codeBlocks.forEach((block) => {
      if (block.start > lastIndex) {
        rawParts.push({ type: 'text', content: text.substring(lastIndex, block.start) });
      }
      rawParts.push({ type: 'code', language: block.language, code: block.code });
      lastIndex = block.end;
    });
    if (lastIndex < text.length) {
      rawParts.push({ type: 'text', content: text.substring(lastIndex) });
    }
  }

  // Pre-process parts: Convert LaTeX/Math code blocks to text with $$ delimiters
  const parts = [];
  rawParts.forEach(part => {
    const isMathCode = part.type === 'code' && ['latex', 'tex', 'math'].includes(part.language.toLowerCase());

    if (isMathCode) {
      // Convert to display math text
      const mathContent = `\n$$${part.code}$$\n`;
      // Merge with previous text part if possible
      if (parts.length > 0 && parts[parts.length - 1].type === 'text') {
        parts[parts.length - 1].content += mathContent;
      } else {
        parts.push({ type: 'text', content: mathContent });
      }
    } else if (part.type === 'text') {
      // Merge with previous text part if possible
      if (parts.length > 0 && parts[parts.length - 1].type === 'text') {
        parts[parts.length - 1].content += part.content;
      } else {
        parts.push(part);
      }
    } else {
      parts.push(part);
    }
  });

  // Render with typing animation
  let charCount = 0;
  const typingSpeed = 8;

  parts.forEach((part) => {
    if (part.type === 'code') {
      // Code blocks appear instantly
      const codeId = `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const codeLines = part.code.trimEnd().split('\n');
      const lineCount = codeLines.length;

      let lineNumbersHTML = '';
      for (let i = 1; i <= lineCount; i++) {
        lineNumbersHTML += `<span class="line-number">${i}</span>\n`;
      }

      const escapedCode = codeLines.map(line => escapeHtml(line)).join('\n');

      const codeBlockHTML =
        '<div class="code-block-container">' +
        '<div class="code-header">' +
        '<span class="code-language" style="padding: 8px;">' + part.language + '</span>' +
        '<button class="copy-code-btn" data-code-id="' + codeId + '" title="Copy code">' +
        '<span class="material-icons-round copy-icon">content_copy</span>' +
        '<span class="copy-text">Copy</span>' +
        '</button>' +
        '</div>' +
        '<div class="code-wrapper">' +
        '<div class="line-numbers" aria-hidden="true">' + lineNumbersHTML.trim() + '</div>' +
        '<pre class="code-block"><code style="padding: 6px 16px;" id="' + codeId + '" class="language-' + part.language + '">' +
        escapedCode +
        '</code></pre>' +
        '</div>' +
        '</div>';
      setTimeout(() => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = codeBlockHTML;
        const codeBlockElement = tempDiv.firstElementChild;
        element.appendChild(codeBlockElement);

        setTimeout(() => {
          const codeElement = document.getElementById(codeId);
          const lineNumbersElement = codeBlockElement.querySelector('.line-numbers');
          if (codeElement && lineNumbersElement) {
            const codeHeight = codeElement.offsetHeight;
            const lineNumbersHeight = lineNumbersElement.offsetHeight;
            if (Math.abs(codeHeight - lineNumbersHeight) > 2) {
              lineNumbersElement.style.minHeight = codeHeight + 'px';
            }
          }
        }, 10);

        attachCopyButtons(element);
      }, charCount * typingSpeed);
    } else {
      // Process text with math protection
      const tempElement = document.createElement("div");

      // Protect math expressions from marked processing
      const mathStore = [];
      const protectMath = (content) => {
        return content
          .replace(/\$\$([\s\S]*?)\$\$/g, (match, code) => {
            mathStore.push(code); // Store content without delimiters
            return `MATHBLOCK${mathStore.length - 1}ENDMATHBLOCK`;
          })
          .replace(/\$((?:\\.|[^\\$`])*)\$/g, (match, code) => {
            mathStore.push(code); // Store content without delimiters
            return `MATHINLINE${mathStore.length - 1}ENDMATHINLINE`;
          });
      };

      const protectedContent = protectMath(part.content);

      // Parse the content with marked
      let parsedHTML = parse(protectedContent, { breaks: true });

      // Restore math expressions wrapped in special span for atomic typing
      parsedHTML = parsedHTML.replace(/MATH(BLOCK|INLINE)(\d+)ENDMATH(BLOCK|INLINE)/g, (match, type, index) => {
        const mathCode = mathStore[parseInt(index, 10)];
        const delimiter = type === 'BLOCK' ? '$$' : '$';
        // Wrap in span.math-content and escape the inner math code to be safe HTML
        // We include the delimiters inside the span so MathJax finds them
        return `<span class="math-content">${delimiter}${escapeHtml(mathCode)}${delimiter}</span>`;
      });

      tempElement.innerHTML = parsedHTML;

      const processNode = (node, parent) => {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('math-content')) {
          // Atomic handling for math blocks - do not split children
          const clonedNode = node.cloneNode(true);
          clonedNode.style.display = 'none';
          parent.appendChild(clonedNode);

          setTimeout(() => {
            clonedNode.style.display = 'inline';
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }, charCount * typingSpeed);

          charCount += 1; // Treat the whole math block as 1 unit of typing
        } else if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          for (let j = 0; j < text.length; j++) {
            const span = document.createElement("span");
            span.textContent = text[j];
            span.style.display = "none";
            parent.appendChild(span);

            setTimeout(() => {
              span.style.display = "inline";
              chatContainer.scrollTop = chatContainer.scrollHeight;
            }, charCount * typingSpeed);
            charCount++;
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const clonedNode = node.cloneNode(false);
          parent.appendChild(clonedNode);

          // Process children
          Array.from(node.childNodes).forEach(child => {
            processNode(child, clonedNode);
          });
        }
      };

      Array.from(tempElement.childNodes).forEach(node => {
        processNode(node, element);
      });
    }
  });

  // Finalize: MathJax and copy buttons
  setTimeout(() => {
    attachCopyButtons(element);
    if (window.MathJax) {
      MathJax.typesetPromise([element]).catch((err) => console.log('MathJax error:', err));
    }
  }, charCount * typingSpeed + 300);
}

// Function to attach copy button functionality
function attachCopyButtons(container) {
  const copyButtons = container.querySelectorAll('.copy-code-btn');
  copyButtons.forEach(button => {
    // Remove existing listeners by cloning
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);

    newButton.addEventListener('click', async () => {
      const codeId = newButton.getAttribute('data-code-id');
      const codeElement = document.getElementById(codeId);
      if (codeElement) {
        const codeText = codeElement.textContent;
        try {
          await navigator.clipboard.writeText(codeText);
          // Show feedback
          const copyIcon = newButton.querySelector('.copy-icon');
          const copyText = newButton.querySelector('.copy-text');
          copyIcon.textContent = 'check';
          copyText.textContent = 'Copied!';
          newButton.classList.add('copied');

          setTimeout(() => {
            copyIcon.textContent = 'content_copy';
            copyText.textContent = 'Copy';
            newButton.classList.remove('copied');
          }, 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = codeText;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);

          const copyText = newButton.querySelector('.copy-text');
          copyText.textContent = 'Copied!';
          setTimeout(() => {
            copyText.textContent = 'Copy';
          }, 2000);
        }
      }
    });
  });
}

// Generate unique ID for each message
function generateUniqueId() {
  const timestamp = Date.now();
  const randomNumber = Math.random();
  const hexadecimalString = randomNumber.toString(16);

  return `id-${timestamp}-${hexadecimalString}`;
}

// Function to create the chat stripe (bubble) for each message
function chatStripe(isAi, value, uniqueId) {
  // Resolve logo path at runtime to ensure it's correct
  const logoPath = isAi ? getAILogoPath() : user;
  // For AI logo, add error handling with fallback paths
  const imgTag = isAi
    ? `<img src="${logoPath}" alt="bot" onerror="if(this.src!=='./AI_logo.png'){this.src='./AI_logo.png';}else if(this.src!=='AI_logo.png'){this.src='AI_logo.png';}else{console.error('Failed to load AI logo');}" />`
    : `<img src="${logoPath}" alt="user" />`;

  // Format user messages to preserve line breaks, AI messages are already formatted
  const formattedValue = isAi ? value : formatUserMessage(value);

  // NO NEWLINES, NO GHOST NODES
  return '<div class="wrapper ' + (isAi ? 'ai' : 'user') + '">' +
    '<div class="chat">' +
    '<div class="profile ' + (isAi ? 'ai-profile' : '') + '"' +
    (isAi ? ' id="ai-profile-' + uniqueId + '"' : '') + '>' +
    imgTag +
    '</div>' +
    '<div class="message" id="' + uniqueId + '">' + formattedValue + '</div>' +
    '</div>' +
    '</div>';
}

// Handle form submission and chat functionality
const handleSubmit = async (e) => {
  e.preventDefault();

  const data = new FormData(form);
  const prompt = data.get("prompt").trim(); // Trim any leading or trailing whitespace
  // Use "openai" ONLY if Model 2 is explicitly turned "Online" (toggle checked)
  const selectedModel = modelToggle && modelToggle.checked ? "openai" : "gemini";

  // Check if the message is empty, if so, do not submit
  if (!prompt) {
    alert("Please enter a message.");
    return;
  }

  const currentTime = Date.now();

  // Check if enough time has passed since the last request (2 seconds in this case)
  if (currentTime - lastRequestTime < 2000) {
    alert("Please wait a moment before sending another request.");
    return;
  }

  // Update the last request time
  lastRequestTime = currentTime;

  // Hide the hero section when chat starts
  const heroSection = document.getElementById("hero-section");
  if (heroSection) {
    heroSection.style.display = "none";
  }

  // User's chat stripe - use insertAdjacentHTML for better performance
  chatContainer.insertAdjacentHTML('beforeend', chatStripe(false, prompt));

  // Force a reflow to ensure the element is rendered before continuing
  chatContainer.offsetHeight;

  // Clear the textarea input and reset height
  form.reset();
  const promptInput = document.getElementById("prompt");
  if (promptInput) {
    promptInput.style.height = 'auto';
    promptInput.style.height = '44px'; // Reset to minimum height
    promptInput.style.overflowY = 'hidden';
  }

  // Animate the send icon
  sendIcon.classList.add("animate-send");

  // Remove the animation class after it ends so it can trigger again next time
  sendIcon.addEventListener(
    "animationend",
    () => {
      sendIcon.classList.remove("animate-send");
    },
    { once: true }
  );

  // Bot's chat stripe
  const uniqueId = generateUniqueId();
  chatContainer.insertAdjacentHTML('beforeend', chatStripe(true, " ", uniqueId));

  // Force a reflow again
  chatContainer.offsetHeight;

  // Scroll to the bottom after DOM update - use double RAF for better reliability
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    });
  });

  // Specific message div for the bot response
  const messageDiv = document.getElementById(uniqueId);

  // Function to get AI profile element (defined in outer scope for catch block)
  const getAIProfile = () => {
    return document.getElementById(`ai-profile-${uniqueId}`) ||
      messageDiv?.closest('.wrapper.ai')?.querySelector('.profile');
  };

  // Get the AI profile element and add rotation animation
  const aiProfile = getAIProfile();
  if (aiProfile) {
    aiProfile.classList.add("thinking");
  } else {
    // Retry after a short delay if element not found immediately
    setTimeout(() => {
      const retryProfile = getAIProfile();
      if (retryProfile) {
        retryProfile.classList.add("thinking");
      }
    }, 50);
  }

  // Show loading indicator while waiting for response.
  loader(messageDiv);

  // Backend server URLs
  const live = "https://infogeniusai-server.onrender.com";
  const dev = "http://localhost:5001"; // For local development only

  try {
    // Send the user's message to the backend for processing
    const response = await fetch(live, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt,
        sessionId: getSessionId(),
        model: selectedModel,
      }),
    });

    // Clear the loading indicator
    clearInterval(loadInterval);
    messageDiv.innerHTML = "";

    // Stop the AI logo rotation animation
    const currentAIProfile = getAIProfile();
    if (currentAIProfile) {
      currentAIProfile.classList.remove("thinking");
    }

    if (response.ok) {
      // Parse the bot's response
      const responseData = await response.json();
      const parsedData = responseData.bot.trim(); // Trim any trailing spaces/'\n'

      // Display the bot's response with typing animation
      typeText(messageDiv, parsedData);
    } else {
      const errorText = await response.text();

      // Handle different error types with user-friendly messages
      if (errorText.includes("QUOTA_EXCEEDED") || errorText.toLowerCase().includes("quota")) {
        messageDiv.innerHTML =
          "Sorry for the inconvenience! The AI is temporarily unavailable due to API quota limits. We are working to get things back up and running. Please try again shortly!";
      } else if (errorText.includes("API_KEY_ERROR") || errorText.toLowerCase().includes("api key")) {
        messageDiv.innerHTML =
          "Configuration error: API key is invalid or missing. Please check the server configuration.";
      } else if (response.status === 500) {
        messageDiv.innerHTML =
          "Server error occurred. Please try again. If the problem persists, check the server logs.";
      } else if (response.status === 0 || !response.status) {
        messageDiv.innerHTML =
          "Network error: Unable to connect to the server. Please check your internet connection and ensure the server is running.";
      } else {
        // Generic error message
        messageDiv.innerHTML = `Error (${response.status}): ${errorText || 'An unexpected error occurred. Please try again.'}`;
      }
    }
  } catch (error) {
    // Handle errors such as network issues
    clearInterval(loadInterval);

    // Stop the AI logo rotation animation on error
    const currentAIProfile = getAIProfile();
    if (currentAIProfile) {
      currentAIProfile.classList.remove("thinking");
    }

    // Show user-friendly error message based on error type
    const errorMessage = error.message || String(error);

    if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError') || errorMessage.includes('ERR_NETWORK')) {
      messageDiv.innerHTML = "Network error: Unable to connect to the server. Please check:<br>• Your internet connection<br>• That the server is running on http://localhost:5001<br>• Your firewall settings";
    } else if (errorMessage.includes('CORS')) {
      messageDiv.innerHTML = "CORS error: The server may not be configured to accept requests from this origin.";
    } else {
      messageDiv.innerHTML = `Error: ${errorMessage}<br><br>Please check the browser console for more details.`;
    }

    console.error('Error:', error);
  }
};

// Function to auto-expand textarea
function autoExpandTextarea(textarea) {
  // Reset height to auto to get the correct scrollHeight
  textarea.style.height = 'auto';

  // Calculate the new height based on scrollHeight
  const scrollHeight = textarea.scrollHeight;
  const minHeight = 44; // Minimum height in pixels
  const maxHeight = 200; // Maximum height in pixels

  // Set the height, clamping between min and max
  const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
  textarea.style.height = newHeight + 'px';

  // If content exceeds max height, show scrollbar
  if (scrollHeight > maxHeight) {
    textarea.style.overflowY = 'auto';
  } else {
    textarea.style.overflowY = 'hidden';
  }
}

// Event listeners to handle form submission and input behavior
document.addEventListener("DOMContentLoaded", function () {
  // Clear chat container on page load to ensure fresh start
  if (chatContainer) {
    chatContainer.innerHTML = '';
  }

  // Show hero section on fresh page load
  const heroSection = document.getElementById("hero-section");
  if (heroSection) {
    heroSection.style.display = "flex";
  }

  if (promptInput) {
    promptInput.focus();

    // Auto-expand textarea on input
    promptInput.addEventListener('input', () => {
      autoExpandTextarea(promptInput);
    });

    // Auto-expand on paste
    promptInput.addEventListener('paste', () => {
      setTimeout(() => {
        autoExpandTextarea(promptInput);
      }, 0);
    });

    // Handle Enter key for submission
    promptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    });

    // Initial height adjustment
    autoExpandTextarea(promptInput);
  }

  // Theme Toggling Logic
  if (themeBtn) {
    const themeIcon = themeBtn.querySelector('span');
    const body = document.body;

    themeBtn.addEventListener('click', () => {
      body.classList.toggle('light-mode');
      if (body.classList.contains('light-mode')) {
        themeIcon.textContent = 'dark_mode';
      } else {
        themeIcon.textContent = 'light_mode';
      }
    });
  }

  if (form) {
    form.addEventListener("submit", handleSubmit);
  }

  // Model 2 Status Logic
  if (modelToggle && modelStatusLabel && toggleContainer) {
    const updateModel2UI = (isOnline) => {
      if (isOnline) {
        modelStatusLabel.textContent = "Model 2 Online";
        toggleContainer.classList.add("online");
      } else {
        modelStatusLabel.textContent = "Model 2 Offline";
        toggleContainer.classList.remove("online");
      }
    };

    // Load initial state
    const isModel2Online = localStorage.getItem("model2_online") === "true";
    modelToggle.checked = isModel2Online;
    updateModel2UI(isModel2Online);

    modelToggle.addEventListener("change", (e) => {
      const isOnline = e.target.checked;
      localStorage.setItem("model2_online", isOnline);
      updateModel2UI(isOnline);
    });
  }
});

// Service Worker Registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("./service-worker.js?v=3")
      .then(function (registration) {
        console.log("Service Worker registered with scope:", registration.scope);
      })
      .catch(function (error) {
        console.log("Service Worker registration failed:", error);
      });
  });
}