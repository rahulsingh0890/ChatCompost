# ChatCompost

<img src="icons/logo.png" alt="ChatCompost Logo" width="64" height="64">

A Chrome extension that makes it easy to bulk delete **ChatGPT** and **Google Gemini** conversations with checkboxes and a single click.

## What it does

ChatCompost adds checkboxes to each conversation in your ChatGPT or Gemini sidebar, allowing you to select multiple conversations and delete them all at once. No more clicking through each conversation individually!

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the folder containing this extension

### After updating an existing installation

1. Open `chrome://extensions/` and click the reload button on **ChatCompost**
2. Refresh any open ChatGPT or Gemini tabs so they use the updated script
3. Scroll to load older chats, then create a new chat and check that both receive checkboxes

## How to use

1. Navigate to [chatgpt.com](https://chatgpt.com) or [gemini.google.com](https://gemini.google.com) and open your conversation sidebar
2. You'll see checkboxes appear next to each conversation
3. Select the conversations you want to delete by checking their boxes
4. A floating "Delete Selected" button will appear at the bottom of the page showing the count of selected conversations
5. Click the button to delete all selected conversations
6. Confirm the deletion when prompted

## Features

- ✅ Works on both **ChatGPT** and **Google Gemini**
- ✅ Checkbox selection for multiple conversations
- ✅ Visual count of selected conversations
- ✅ Bulk delete with a single click
- ✅ Confirmation dialog to prevent accidental deletions
- ✅ Automatic page refresh after deletion to show updated list

## Supported Platforms

| Platform | URL | Deletion Method |
|----------|-----|-----------------|
| ChatGPT | chatgpt.com, chat.openai.com | API |
| Google Gemini | gemini.google.com | UI Automation |

## Permissions

This extension only runs on ChatGPT and Gemini pages. It uses content scripts that automatically run when you visit these pages. The extension does not access any other websites or collect your browsing data.

- **ChatGPT**: Uses API calls to delete conversations
- **Gemini**: Uses UI automation (clicking menu buttons) since Gemini has no public deletion API

## Version

Current version: 1.1.0

## Development checks

Run `npm ci` and `npm test` with Node.js 18 or newer. The tests simulate sidebar
updates, replacement, new conversation URLs, and checkbox selection without
contacting either service or deleting chats. The extension itself needs no build
step or installed dependencies.
