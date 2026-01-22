console.log("🔥 Script loaded");
import user from "./assets/user-icon.svg";

const form = document.querySelector("form");
const chatContainer = document.querySelector("#chat_container");
const sendIcon = document.getElementById("sendIcon");

let loadInterval;
let lastRequestTime = 0; // Track the time of the last request

// Persistent session id for better chat history on server
function getSessionId() {
  const key = "infogenius_session_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

// Function to create the typing loader animation
function loader(element) {
  element.textContent = "";

  loadInterval = setInterval(() => {
    // Update the text content of the loading indicator
    element.textContent += ".";

    // If the loading indicator has reached three dots, reset it
    if (element.textContent === "....") {
      element.textContent = "";
    }
  }, 300);
}

// Function to format code blocks with copy button
function formatCodeBlocks(text) {
  // Match code blocks with ```language or ```
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  
  return text.replace(codeBlockRegex, (match, lang, code) => {
    const language = lang || 'text';
    const codeId = `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const escapedCode = escapeHtml(code.trim());
    
    return `
      <div class="code-block-container">
        <div class="code-header">
          <span class="code-language">${language}</span>
          <button class="copy-code-btn" data-code-id="${codeId}" title="Copy code">
            <span class="material-icons-round copy-icon">content_copy</span>
            <span class="copy-text">Copy</span>
          </button>
        </div>
        <pre class="code-block"><code id="${codeId}" class="language-${language}">${escapedCode}</code></pre>
      </div>
    `;
  });
}

// Function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  processed = processed.replace(/\n/g, '<br>');
  
  return processed;
}

// Function to simulate typing animation for bot responses
function typeText(element, text) {
  element.innerHTML = ""; // Clear the content before typing
  
  // Split text by code blocks
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  const codeBlocks = [];
  
  // Find all code blocks
  while ((match = codeBlockRegex.exec(text)) !== null) {
    codeBlocks.push({
      start: match.index,
      end: match.index + match[0].length,
      language: match[1] || 'text',
      code: match[2].trim()
    });
  }
  
  // Build parts array
  if (codeBlocks.length === 0) {
    parts.push({ type: 'text', content: text });
  } else {
    codeBlocks.forEach((block) => {
      if (block.start > lastIndex) {
        parts.push({ type: 'text', content: text.substring(lastIndex, block.start) });
      }
      parts.push({ type: 'code', language: block.language, code: block.code });
      lastIndex = block.end;
    });
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.substring(lastIndex) });
    }
  }
  
  // Render with typing animation
  let charCount = 0;
  const typingSpeed = 8;
  
  parts.forEach((part) => {
    if (part.type === 'code') {
      // Code blocks appear instantly
      const codeId = `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const escapedCode = escapeHtml(part.code);
      const codeBlockHTML = `
        <div class="code-block-container">
          <div class="code-header">
            <span class="code-language">${part.language}</span>
            <button class="copy-code-btn" data-code-id="${codeId}" title="Copy code">
              <span class="material-icons-round copy-icon">content_copy</span>
              <span class="copy-text">Copy</span>
            </button>
          </div>
          <pre class="code-block"><code id="${codeId}" class="language-${part.language}">${escapedCode}</code></pre>
        </div>
      `;
      
      setTimeout(() => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = codeBlockHTML;
        element.appendChild(tempDiv.firstElementChild);
        attachCopyButtons(element);
      }, charCount * typingSpeed);
    } else {
      // Process and animate text
      let processedText = formatInlineCode(part.content);
      processedText = formatLinks(processedText);
      processedText = processedText.replace(/\n/g, '<br>');
      
      const tempElement = document.createElement("div");
      tempElement.innerHTML = processedText;
      
      const processNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          for (let j = 0; j < text.length; j++) {
            const span = document.createElement("span");
            span.textContent = text[j];
            span.style.display = "none";
            element.appendChild(span);
            
            setTimeout(() => {
              span.style.display = "inline";
            }, charCount * typingSpeed);
            charCount++;
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const clonedNode = node.cloneNode(true);
          // Clear cloned node's children, we'll add them separately
          while (clonedNode.firstChild) {
            clonedNode.removeChild(clonedNode.firstChild);
          }
          clonedNode.style.display = "none";
          element.appendChild(clonedNode);
          
          const displayTime = charCount * typingSpeed;
          // Process children
          Array.from(node.childNodes).forEach(child => {
            processNode(child);
          });
          
          setTimeout(() => {
            clonedNode.style.display = "";
          }, displayTime);
        }
      };
      
      Array.from(tempElement.childNodes).forEach(node => {
        processNode(node);
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
  return `
    <div class="wrapper ${isAi ? "ai" : "user"}">
        <div class="chat">
            <div class="profile ${isAi ? "ai-profile" : ""}" ${isAi ? `id="ai-profile-${uniqueId}"` : ""}>
                <img src="${isAi ? "./AI_logo.png" : user}" alt="${isAi ? "bot" : "user"
    }" />
            </div>
            <div class="message" id="${uniqueId}">${value}</div>
        </div>
    </div>
    `;
}

// Handle form submission and chat functionality
const handleSubmit = async (e) => {
  e.preventDefault();

  const data = new FormData(form);
  const prompt = data.get("prompt").trim(); // Trim any leading or trailing whitespace

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

  // User's chat stripe
  chatContainer.innerHTML += chatStripe(false, prompt);

  // Clear the textarea input
  form.reset();

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
  chatContainer.innerHTML += chatStripe(true, " ", uniqueId);

  // Scroll to the bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;

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
  const live = "https://updatedai-x4al.onrender.com";
  const dev = "http://127.0.0.1:5000"; // For local development only

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

      // If there's an error, display a message
      if (errorText.includes("quota")) {
        messageDiv.innerHTML =
          "Sorry for the inconvenience! The AI is temporarily unavailable. We are working to get things back up and running. Please try again shortly!";
      } else {
        messageDiv.innerHTML =
          "Apologies, the website has been disabled by Karan Ram.";
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
    
    // Show user-friendly error message
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      messageDiv.innerHTML = "Network error: Please check your internet connection and try again.";
    } else {
      messageDiv.innerHTML = "Sorry, there was an error processing your request. Please try again.";
    }
    
    console.error('Error:', error);
  }
};

// Event listeners to handle form submission and input behavior
document.addEventListener("DOMContentLoaded", function () {
  const promptInput = document.getElementById("prompt");

  document.getElementById("prompt").focus();

  form.addEventListener("submit", handleSubmit);
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  });
});


if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .then(() => console.log("Service Worker Registered"));
}