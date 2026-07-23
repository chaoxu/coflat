-- Pandoc filter: Coflat-flavored markdown -> LaTeX.
--
-- Responsibilities:
--   * YAML "math:" frontmatter -> \newcommand in header-includes.
--   * Pandoc citations that target document labels export as \cref.
--     Bibliography citations are left for citeproc.
--   * Manifest-backed fenced-div blocks
--     divs -> matching LaTeX environments.
--   * Multi-image figure divs -> subfigure wrappers.
--   * <br> in table cells -> \newline.
--
-- A `title="..."` attribute on the div (added by the Coflat lift-titles step)
-- is used as the theorem title / figure caption / table caption / algorithm
-- caption.

local function script_dir()
  local source = debug.getinfo(1, "S").source
  local path = source and source:match("^@(.+)$") or nil
  if not path then return "./" end
  return path:match("^(.*[/\\])") or "./"
end

local syntax = dofile(script_dir() .. "syntax-manifest.lua")

local function first_latex_class(classes)
  for _, c in ipairs(classes) do
    local kind = syntax.latex_kind_by_block[c]
    if kind and kind ~= "none" then return c, kind end
  end
  return nil, nil
end

local function label_for(id)
  if id and id ~= "" then return "\\label{" .. id .. "}" else return "" end
end

local function add_label(labels, id)
  if id and id ~= "" then labels[id] = true end
end

local function add_latex_labels(labels, text)
  if not text then return end
  for id in text:gmatch("\\label%s*{%s*([^}%s]+)%s*}") do labels[id] = true end
end

local function collect_document_labels(doc)
  local labels = {}
  doc:walk({
    Header = function(el) add_label(labels, el.identifier) end,
    Div = function(el) add_label(labels, el.identifier) end,
    Span = function(el) add_label(labels, el.identifier) end,
    Figure = function(el) add_label(labels, el.identifier) end,
    Table = function(el) add_label(labels, el.identifier) end,
    RawBlock = function(el)
      if el.format == "latex" or el.format == "tex" then add_latex_labels(labels, el.text) end
    end,
    RawInline = function(el)
      if el.format == "latex" or el.format == "tex" then add_latex_labels(labels, el.text) end
    end,
  })
  return labels
end

local function raw(s) return pandoc.RawBlock("latex", s) end

local latex_text_escapes = {
  ["\\"] = "\\textbackslash{}",
  ["{"] = "\\{",
  ["}"] = "\\}",
  ["$"] = "\\$",
  ["&"] = "\\&",
  ["#"] = "\\#",
  ["_"] = "\\_",
  ["%"] = "\\%",
  ["~"] = "\\textasciitilde{}",
  ["^"] = "\\textasciicircum{}",
}

local function escape_latex_text(s)
  if not s or s == "" then return "" end
  return (s:gsub(".", function(ch) return latex_text_escapes[ch] or ch end))
end

local function pop_title(el)
  return el.attributes and el.attributes.title or nil
end

local function make_env(name, title, id, content)
  local opt = (title and title ~= "") and ("[" .. escape_latex_text(title) .. "]") or ""
  local out = { raw("\\begin{" .. name .. "}" .. opt .. label_for(id)) }
  for _, b in ipairs(content) do table.insert(out, b) end
  -- The LaTeX writer separates blocks with a blank line, so a standalone
  -- \end{...} block leaves an empty line closing every environment and pushes
  -- the proof QED mark onto its own line. Glue \end{...} onto the last
  -- paragraph instead whenever one exists.
  local endtag = "\\end{" .. name .. "}"
  local last = out[#out]
  if #out > 1 and (last.t == "Para" or last.t == "Plain") then
    last.content:insert(pandoc.RawInline("latex", endtag))
  else
    table.insert(out, raw(endtag))
  end
  return out
end

local function inlines_to_latex(inlines)
  if not inlines or #inlines == 0 then return "" end
  return pandoc.write(pandoc.Pandoc({ pandoc.Plain(inlines) }), "latex")
end

local function markdown_title_to_latex(title)
  if not title or title == "" then return "" end
  local ok, doc = pcall(
    pandoc.read,
    title,
    "markdown+tex_math_dollars+tex_math_single_backslash"
  )
  if not ok then return escape_latex_text(title) end
  local block = doc.blocks and doc.blocks[1] or nil
  if block and (block.t == "Plain" or block.t == "Para") then
    return inlines_to_latex(block.content):gsub("%s+$", "")
  end
  return escape_latex_text(title)
end

local function handle_figure(el)
  local title = markdown_title_to_latex(pop_title(el) or "")
  local id = el.identifier
  local images = {}

  local function collect(block)
    if block.t == "Figure" then
      local img
      pandoc.walk_block(block, { Image = function(i) img = img or i end })
      if img then
        local caption_inlines = block.caption.long and block.caption.long[1]
                                  and block.caption.long[1].content
        local cap = inlines_to_latex(caption_inlines)
        if (not cap) or cap == "" then cap = inlines_to_latex(img.caption) end
        table.insert(images, { src = img.src, caption = cap })
      end
      return
    end
    if block.content then
      pandoc.walk_block(block, {
        Image = function(img)
          table.insert(images, { src = img.src, caption = inlines_to_latex(img.caption) })
        end,
      })
    end
  end

  for _, b in ipairs(el.content) do collect(b) end

  if #images == 0 then return nil end

  local out = { raw("\\begin{figure}[ht]\\centering") }

  if #images == 1 then
    local img = images[1]
    table.insert(out, raw("\\includegraphics[width=0.8\\linewidth]{" .. img.src .. "}"))
  else
    local width = string.format("%.3f", 1.0 / math.min(#images, 3) - 0.01)
    for _, img in ipairs(images) do
      table.insert(out, raw("\\begin{subfigure}[t]{" .. width .. "\\textwidth}\\centering"))
      table.insert(out, raw("\\includegraphics[width=\\linewidth]{" .. img.src .. "}"))
      table.insert(out, raw("\\caption{" .. img.caption .. "}"))
      table.insert(out, raw("\\end{subfigure}\\hfill"))
    end
  end

  table.insert(out, raw("\\caption{" .. title .. "}" .. label_for(id)))
  table.insert(out, raw("\\end{figure}"))
  return out
end

local function cell_to_latex(cell)
  local parts = {}
  for _, blk in ipairs(cell.contents) do
    if blk.t == "Plain" or blk.t == "Para" then
      local inlines = {}
      for _, inl in ipairs(blk.content) do
        local is_br = inl.t == "LineBreak"
        if inl.t == "RawInline" and inl.format == "html" then
          local t = inl.text:lower():gsub("%s", "")
          if t == "<br>" or t == "<br/>" or t == "<br />" then
            is_br = true
          end
        end
        if is_br then
          table.insert(inlines, pandoc.RawInline("latex", "\\newline "))
        else
          table.insert(inlines, inl)
        end
      end
      local s = inlines_to_latex(inlines)
      s = s:gsub("%s+$", "")
      table.insert(parts, s)
    end
  end
  return table.concat(parts, " \\newline ")
end

local function rows_to_latex(rows)
  local lines = {}
  for _, row in ipairs(rows) do
    local cells = {}
    for _, cell in ipairs(row.cells) do
      table.insert(cells, cell_to_latex(cell))
    end
    table.insert(lines, table.concat(cells, " & ") .. " \\\\")
  end
  return table.concat(lines, "\n")
end

local function colspec_of(colspecs)
  local parts = { "@{}" }
  for _, cs in ipairs(colspecs) do
    local w = cs[2]
    if type(w) == "number" and w > 0.15 then
      table.insert(parts, "X")
    else
      table.insert(parts, "l")
    end
  end
  table.insert(parts, "@{}")
  return table.concat(parts)
end

local function handle_table_div(el)
  local title = markdown_title_to_latex(pop_title(el) or "")
  local id = el.identifier
  for _, b in ipairs(el.content) do
    if b.t == "Table" then
      local colspec = colspec_of(b.colspecs)
      local head_rows = rows_to_latex(b.head.rows)
      local body_lines = {}
      for _, body in ipairs(b.bodies) do
        table.insert(body_lines, rows_to_latex(body.body))
      end
      local body_rows = table.concat(body_lines, "\n")
      local latex = table.concat({
        "\\begin{table}[!htbp]",
        "\\centering",
        "\\caption{" .. title .. "}" .. label_for(id),
        "\\small",
        "\\begin{tabularx}{\\textwidth}{" .. colspec .. "}",
        "\\toprule",
        head_rows,
        "\\midrule",
        body_rows,
        "\\bottomrule",
        "\\end{tabularx}",
        "\\end{table}",
      }, "\n")
      return { raw(latex) }
    end
  end
  return nil
end

local function handle_algorithm(el)
  local title = markdown_title_to_latex(pop_title(el) or "")
  local id = el.identifier
  local out = { raw("\\begin{algorithm}[H]\\caption{" .. title .. "}" .. label_for(id)) }
  for _, b in ipairs(el.content) do table.insert(out, b) end
  table.insert(out, raw("\\end{algorithm}"))
  return out
end

-- Erickson-style .algo blocks. The Coflat preprocess step rewrites the algo
-- body into a pandoc line block ("| " prefix per line), which preserves both
-- the line structure and the leading indentation (pandoc encodes leading
-- spaces as U+00A0 on the first Str of each line). Export maps 2 spaces to
-- one tabbing indent level, emitted as \+ / \- deltas between lines.
local NBSP = "\194\160"

-- Strip leading non-breaking spaces from a line-block line; returns the
-- indent depth (2 space units = 1 level) and the remaining inlines.
local function algo_line_depth(inlines)
  local first = inlines[1]
  if not first or first.t ~= "Str" then return 0, inlines end
  local text = first.text
  local units = 0
  local i = 1
  while text:sub(i, i + 1) == NBSP do
    units = units + 1
    i = i + 2
  end
  if units == 0 then return 0, inlines end
  local rest = { table.unpack(inlines) }
  local remainder = text:sub(i)
  if remainder == "" then
    table.remove(rest, 1)
  else
    rest[1] = pandoc.Str(remainder)
  end
  return math.floor(units / 2), rest
end

local function handle_algo(el)
  local title = markdown_title_to_latex(pop_title(el) or "")
  local id = el.identifier
  local rows = {}
  for _, b in ipairs(el.content) do
    if b.t == "LineBlock" then
      if #rows > 0 then
        -- Blank source line between two line blocks: preserved as an empty row.
        table.insert(rows, { depth = rows[#rows].depth, tex = "" })
      end
      for _, line in ipairs(b.content) do
        local depth, rest = algo_line_depth(line)
        table.insert(rows, { depth = depth, tex = inlines_to_latex(rest):gsub("%s+$", "") })
      end
    end
  end
  local body = {}
  for i, row in ipairs(rows) do
    local prev = rows[i - 1]
    local marks = ""
    if prev then
      local delta = row.depth - prev.depth
      marks = string.rep(delta > 0 and "\\+" or "\\-", math.abs(delta))
    end
    local prefix = (i == 1) and "" or "\\\\ "
    table.insert(body, marks .. prefix .. row.tex)
  end
  local out = { raw("\\begin{algorithm}[H]\\caption{" .. title .. "}" .. label_for(id)) }
  table.insert(out, raw("\\begin{coflatalgo}\n" .. table.concat(body, "\n") .. "\n\\end{coflatalgo}"))
  table.insert(out, raw("\\end{algorithm}"))
  return out
end

local function handle_blockquote(el)
  local out = { raw("\\begin{quote}") }
  for _, b in ipairs(el.content) do table.insert(out, b) end
  table.insert(out, raw("\\end{quote}"))
  return out
end

local function transform_div(el)
  local cls, kind = first_latex_class(el.classes)
  if kind == "environment" then
    return make_env(syntax.latex_environment_by_block[cls], pop_title(el), el.identifier, el.content)
  end
  if kind == "figure" then return handle_figure(el) end
  if kind == "table" then return handle_table_div(el) end
  if kind == "algorithm" then return handle_algorithm(el) end
  if kind == "algo" then return handle_algo(el) end
  if kind == "blockquote" then return handle_blockquote(el) end
  return nil
end

local function transform_cite(el, document_labels)
  local ids = {}
  for _, citation in ipairs(el.citations) do
    if not document_labels[citation.id] then return nil end
    table.insert(ids, citation.id)
  end
  return pandoc.RawInline("latex", "\\cref{" .. table.concat(ids, ",") .. "}")
end

-- Keep the reader profile compatible with Pandoc 2.17, which ships in the
-- Cosheaf production image. Newer optional extensions such as `mark` must not
-- be required by this filter.

function Pandoc(doc)
  local document_labels = collect_document_labels(doc)
  return doc:walk({
    Cite = function(el) return transform_cite(el, document_labels) end,
    Div = transform_div,
    Str = function(el)
      if el.text:find("~", 1, true) then
        el.text = el.text:gsub("~", "\u{00a0}")
        return el
      end
      return nil
    end,
  })
end
