// A deliberately small Markdown subset. Never parse HTML or interpolate source
// into markup. Unknown/incomplete syntax stays readable as text in live previews.
export function safeLink(destination) {
  if (/[^\S ]|[\u0000-\u0020\u007f-\u009f\\<>]/u.test(destination)) return null;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(destination)) return null;
  if (!/^(?:https?:\/\/|mailto:)/i.test(destination)) return null;
  try {
    const url = new URL(destination);
    if (url.protocol === "mailto:")
      return url.pathname && !url.search && !url.hash ? url.href : null;
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function element(document, tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function inline(node, text, depth = 0) {
  const document = node.ownerDocument;
  // Bounded recursion; nested links and images are intentionally unsupported.
  if (depth > 8) {
    node.append(document.createTextNode(text));
    return;
  }
  // Do not retry an opener inside a backtick run or a nested link label.
  // Those retries make long unfinished streaming delimiters quadratic.
  const tokens =
    /\\([\\`*_[\]()>!|])|(?<!`)(`+)([^`]+?)\2(?!`)|(!?\[([^\[\]\n]+)\]\(([^\s()]*)\))|(\*\*|__)(?=\S)(.+?)\7|(\*)(?=\S)([^*]+?)\9/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    node.append(document.createTextNode(text.slice(offset, match.index)));
    if (match[1]) node.append(document.createTextNode(match[1]));
    else if (match[2]) node.append(element(document, "code", match[3]));
    else if (match[4]) {
      const href = match[4].startsWith("!") ? null : safeLink(match[6]);
      if (href) {
        const link = element(document, "a", match[5]);
        link.setAttribute("href", href);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        node.append(link);
      } else node.append(document.createTextNode(match[4]));
    } else {
      const emphasis = element(document, match[7] ? "strong" : "em");
      inline(emphasis, match[8] ?? match[10], depth + 1);
      node.append(emphasis);
    }
    offset = match.index + match[0].length;
  }
  node.append(document.createTextNode(text.slice(offset)));
}

function cells(line) {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  // Escaped pipes remain in the cell; inline() removes the escape.
  return value.split(/(?<!\\)\|/).map((cell) => cell.trim());
}
const fence = (line) => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const heading = (line) => /^ {0,3}(#{1,6})\s+(.+)$/.exec(line);
const listItem = (line) => /^( *)([-+*]|\d{1,9}[.)])\s+(.*)$/.exec(line);
const quote = (line) => /^ {0,3}> ?(.*)$/.exec(line);
const rule = (line) =>
  /^ {0,3}(?:\*\s*){3,}$|^ {0,3}(?:-\s*){3,}$|^ {0,3}(?:_\s*){3,}$/.test(line);
function tableHeader(lines, index) {
  if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|"))
    return null;
  const header = cells(lines[index]),
    separators = cells(lines[index + 1]);
  return header.length === separators.length &&
    separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    ? { header, separators }
    : null;
}
function blocks(node, lines, depth = 0) {
  const document = node.ownerDocument;
  if (depth > 12) {
    node.append(element(document, "p", lines.join("\n")));
    return;
  }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const opening = fence(line);
    if (opening) {
      const content = [];
      const close = new RegExp(
        `^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`,
      );
      i++;
      while (i < lines.length && !close.test(lines[i]))
        content.push(lines[i++]);
      if (i < lines.length) i++;
      const pre = element(document, "pre");
      pre.append(element(document, "code", content.join("\n")));
      node.append(pre);
      continue;
    }
    const title = heading(line);
    if (title) {
      const h = element(document, "h" + title[1].length);
      inline(h, title[2]);
      node.append(h);
      i++;
      continue;
    }
    if (rule(line)) {
      node.append(element(document, "hr"));
      i++;
      continue;
    }
    if (quote(line)) {
      const content = [];
      while (i < lines.length && quote(lines[i]))
        content.push(quote(lines[i++])[1]);
      const blockquote = element(document, "blockquote");
      blocks(blockquote, content, depth + 1);
      node.append(blockquote);
      continue;
    }
    const table = tableHeader(lines, i);
    if (table) {
      const wrapper = element(document, "div");
      wrapper.className = "table-scroll";
      wrapper.setAttribute("tabindex", "0");
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute("aria-label", "表格（可横向滚动）");
      const grid = element(document, "table"),
        head = element(document, "thead"),
        body = element(document, "tbody");
      const row = (values, tag) => {
        const tr = element(document, "tr");
        table.header.forEach((_, index) => {
          const cell = element(document, tag);
          if (tag === "th") cell.setAttribute("scope", "col");
          const separator = table.separators[index];
          cell.className =
            separator.startsWith(":") && separator.endsWith(":")
              ? "align-center"
              : separator.endsWith(":")
                ? "align-right"
                : "align-left";
          inline(cell, values[index] ?? "");
          tr.append(cell);
        });
        return tr;
      };
      head.append(row(table.header, "th"));
      i += 2;
      // A malformed/unfinished row falls back to prose without losing its cells.
      while (
        i < lines.length &&
        lines[i].includes("|") &&
        cells(lines[i]).length === table.header.length
      )
        body.append(row(cells(lines[i++]), "td"));
      grid.append(head, body);
      wrapper.append(grid);
      node.append(wrapper);
      continue;
    }
    const first = listItem(line);
    if (first) {
      const indent = first[1].length,
        ordered = /^\d/.test(first[2]);
      const list = element(document, ordered ? "ol" : "ul");
      if (ordered) list.setAttribute("start", String(parseInt(first[2], 10)));
      while (i < lines.length) {
        const match = listItem(lines[i]);
        if (
          !match ||
          match[1].length !== indent ||
          /^\d/.test(match[2]) !== ordered
        )
          break;
        const content = [match[3]],
          contentIndent = match[1].length + match[2].length + 1;
        i++;
        while (i < lines.length) {
          if (!lines[i].trim()) {
            if (lines[i + 1]?.match(/^ */)[0].length >= contentIndent) {
              content.push("");
              i++;
              continue;
            }
            break;
          }
          const spaces = lines[i].match(/^ */)[0].length;
          if (spaces < contentIndent) break;
          content.push(lines[i++].slice(contentIndent));
        }
        const item = element(document, "li");
        blocks(item, content, depth + 1);
        list.append(item);
      }
      node.append(list);
      continue;
    }
    const content = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !fence(lines[i]) &&
      !heading(lines[i]) &&
      !rule(lines[i]) &&
      !quote(lines[i]) &&
      !listItem(lines[i]) &&
      !tableHeader(lines, i)
    )
      content.push(lines[i++]);
    const paragraph = element(document, "p");
    inline(paragraph, content.join("\n"));
    node.append(paragraph);
  }
}

export function renderMarkdown(node, text) {
  const fragment = node.ownerDocument.createDocumentFragment();
  blocks(
    fragment,
    String(text ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n"),
  );
  node.replaceChildren(fragment);
}
