"""Narrow IF/CASE delimiter regression guard, NOT a PostgreSQL compiler.

Models REL_17_11 pl_gram.y expr_until_then/read_sql_construct's delimiter
depth only. Masks SQL comments/quoted text with the existing lexer. Checks
all candidate function/DO bodies, but does NOT validate SQL expressions,
types, names, procedural grammar, permissions or runtime behavior.
No database, subprocess, network or third-party dependencies.
"""
import re
from static_check import sql_text, top_level_statements


def condition_findings(body):
    """Return narrow structural findings and IF/ELSIF condition offsets.

    Restricts unparenthesized CASE in IF/ELSIF conditions even if a future
    parser accepts it. CASE assignments and CASE within parentheses are OK.
    END IF / IF balance is supplemental; this is not a full block parser.
    """
    masked = sql_text(body, mask_literals=True)
    tokens = list(re.finditer(r'[A-Za-z_][A-Za-z_0-9$]*|[()[\];]', masked))
    words = [m.group().upper() for m in tokens]
    findings, conditions, brackets, if_depth = [], [], [], 0
    for i, word in enumerate(words):
        offset = tokens[i].start()
        if word in ('(', '['):
            brackets.append(word)
        elif word in (')', ']'):
            if not brackets or brackets.pop() != {')': '(', ']': '['}[word]:
                findings.append((offset, 'DELIMITER_MISMATCH'))
        if word == 'IF' and i and words[i - 1] == 'END':
            if_depth -= 1
            if if_depth < 0:
                findings.append((offset, 'END_IF_WITHOUT_IF'))
            continue
        if word not in ('IF', 'ELSIF'):
            continue
        if word == 'IF':
            if_depth += 1
        elif if_depth <= 0:
            findings.append((offset, 'ELSIF_WITHOUT_IF'))
        conditions.append(offset)
        depth, ended = 0, False
        for j in range(i + 1, len(words)):
            value = words[j]
            if value == 'CASE' and depth == 0:
                findings.append((tokens[j].start(), 'IF_CASE_NEEDS_PARENTHESES'))
            if value == 'THEN' and depth == 0:
                ended = True
                break
            if value in ('(', '['):
                depth += 1
            elif value in (')', ']'):
                depth -= 1
            if value == ';' or depth < 0:
                break
        if not ended:
            findings.append((offset, 'IF_THEN_NOT_FOUND'))
    if brackets:
        findings.append((len(body), 'UNCLOSED_DELIMITER'))
    if if_depth:
        findings.append((len(body), 'IF_END_IF_IMBALANCE'))
    return findings, conditions


def audit(source):
    """Enumerate the candidate's sealed declaration forms; reject unknown forms."""
    rows, cursor = [], 0
    for statement in top_level_statements(source):
        function = re.match(r'CREATE FUNCTION ([\w.]+)\(', statement, re.I)
        anonymous = re.match(r'DO\s+(\$[A-Za-z_0-9]*\$)', statement, re.I)
        if not function and not anonymous:
            continue
        name = function[1] if function else 'DO ' + anonymous[1]
        language = re.search(r'\bLANGUAGE\s+(\w+)\b', statement, re.I) if function else None
        lang = language[1].lower() if language else ('plpgsql' if anonymous else 'unknown')
        body_match = re.search(r'(\$[A-Za-z_0-9]*\$)(.*?)\1\s*$', statement, re.S)
        if body_match is None or lang not in ('plpgsql', 'sql'):
            rows.append(dict(name=name, language=lang, issues=['UNSUPPORTED_DECLARATION']))
            continue
        body = body_match[2]
        start = source.find(body, cursor)
        if start < 0:
            raise ValueError('body location unavailable')
        cursor = start + len(body)
        findings, conditions = condition_findings(body) if lang == 'plpgsql' else ([], [])
        rows.append(dict(name=name, language=lang, line=source.count('\n', 0, start) + 1,
                         if_elsif_count=len(conditions),
                         case_count=len(re.findall(r'\bCASE\b', sql_text(body, True), re.I)),
                         issues=[f'{code}:line={source.count(chr(10), 0, start + off) + 1}'
                                 for off, code in findings]))
    return rows


def errors(source):
    return [row['name'] + ':' + issue for row in audit(source) for issue in row['issues']]
