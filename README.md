# ChatCompost

<div align="center">
  <img src="icons/logo.png" alt="ChatCompost Logo" width="128" height="128">
</div>

A Chrome extension that makes it easy to bulk delete ChatGPT conversations with checkboxes and a single click.

## What it does

ChatCompost adds checkboxes to each conversation in your ChatGPT sidebar, allowing you to select multiple conversations and delete them all at once. No more clicking through each conversation individually!

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the folder containing this extension

## How to use

1. Navigate to [chatgpt.com](https://chatgpt.com) and open your conversation sidebar
2. You'll see checkboxes appear next to each conversation
3. Select the conversations you want to delete by checking their boxes
4. A floating "Delete Selected" button will appear at the bottom of the page showing the count of selected conversations
5. Click the button to delete all selected conversations
6. Confirm the deletion when prompted

## Features

- ✅ Checkbox selection for multiple conversations
- ✅ Visual count of selected conversations
- ✅ Bulk delete with a single click
- ✅ Confirmation dialog to prevent accidental deletions
- ✅ Automatic page refresh after deletion to show updated list

## Permissions

This extension only requires the `activeTab` permission, which allows it to work on ChatGPT pages. It does not access any other websites or your browsing data.

## Version

Current version: 1.0.1

