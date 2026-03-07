/** License 도구 — OSS 라이선스 템플릿/감지/비교. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface LicenseInfo {
  id: string; name: string; osi: boolean; copyleft: boolean;
  permissions: string[]; conditions: string[]; limitations: string[];
}

const LICENSES: LicenseInfo[] = [
  { id: "MIT", name: "MIT License", osi: true, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: ["include-copyright"], limitations: ["liability", "warranty"] },
  { id: "Apache-2.0", name: "Apache License 2.0", osi: true, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "patent-use", "private-use"],
    conditions: ["include-copyright", "document-changes"], limitations: ["liability", "trademark-use", "warranty"] },
  { id: "GPL-3.0", name: "GNU GPLv3", osi: true, copyleft: true,
    permissions: ["commercial", "distribution", "modification", "patent-use", "private-use"],
    conditions: ["disclose-source", "include-copyright", "same-license", "document-changes"], limitations: ["liability", "warranty"] },
  { id: "GPL-2.0", name: "GNU GPLv2", osi: true, copyleft: true,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: ["disclose-source", "include-copyright", "same-license"], limitations: ["liability", "warranty"] },
  { id: "LGPL-3.0", name: "GNU LGPLv3", osi: true, copyleft: true,
    permissions: ["commercial", "distribution", "modification", "patent-use", "private-use"],
    conditions: ["disclose-source", "include-copyright", "same-license-library"], limitations: ["liability", "warranty"] },
  { id: "BSD-2-Clause", name: "BSD 2-Clause", osi: true, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: ["include-copyright"], limitations: ["liability", "warranty"] },
  { id: "BSD-3-Clause", name: "BSD 3-Clause", osi: true, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: ["include-copyright"], limitations: ["liability", "warranty"] },
  { id: "MPL-2.0", name: "Mozilla Public License 2.0", osi: true, copyleft: true,
    permissions: ["commercial", "distribution", "modification", "patent-use", "private-use"],
    conditions: ["disclose-source", "include-copyright", "same-license-file"], limitations: ["liability", "trademark-use", "warranty"] },
  { id: "ISC", name: "ISC License", osi: true, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: ["include-copyright"], limitations: ["liability", "warranty"] },
  { id: "Unlicense", name: "The Unlicense", osi: true, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: [], limitations: ["liability", "warranty"] },
  { id: "AGPL-3.0", name: "GNU AGPLv3", osi: true, copyleft: true,
    permissions: ["commercial", "distribution", "modification", "patent-use", "private-use"],
    conditions: ["disclose-source", "include-copyright", "same-license", "network-use-disclose"], limitations: ["liability", "warranty"] },
  { id: "CC0-1.0", name: "CC0 1.0 Universal", osi: false, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: [], limitations: ["liability", "patent-use", "warranty"] },
  { id: "WTFPL", name: "WTFPL", osi: false, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: [], limitations: [] },
  { id: "Zlib", name: "zlib License", osi: true, copyleft: false,
    permissions: ["commercial", "distribution", "modification", "private-use"],
    conditions: ["include-copyright", "document-changes"], limitations: ["liability", "warranty"] },
];

const TEMPLATES: Record<string, string> = {
  MIT: `MIT License

Copyright (c) {{year}} {{author}}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  "Apache-2.0": `Copyright {{year}} {{author}}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`,
  ISC: `ISC License

Copyright (c) {{year}} {{author}}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
  "BSD-2-Clause": `BSD 2-Clause License

Copyright (c) {{year}} {{author}}
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.`,
};

export class LicenseTool extends Tool {
  readonly name = "license";
  readonly category = "data" as const;
  readonly description = "OSS license utilities: generate, detect, info, compare, list, compatible.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "detect", "info", "compare", "list", "compatible"], description: "Operation" },
      id: { type: "string", description: "SPDX license identifier" },
      id2: { type: "string", description: "Second license (compare)" },
      author: { type: "string", description: "Copyright holder name" },
      year: { type: "string", description: "Copyright year" },
      text: { type: "string", description: "License text to detect" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "info");

    switch (action) {
      case "generate": {
        const id = String(params.id || "MIT");
        const template = TEMPLATES[id];
        if (!template) return JSON.stringify({ error: `no template for ${id}`, available: Object.keys(TEMPLATES) });
        const year = String(params.year || new Date().getFullYear());
        const author = String(params.author || "[author]");
        return template.replace(/\{\{year\}\}/g, year).replace(/\{\{author\}\}/g, author);
      }
      case "detect": {
        const text = String(params.text || "").toLowerCase();
        const scores: { id: string; score: number }[] = [];
        for (const lic of LICENSES) {
          let score = 0;
          if (text.includes(lic.id.toLowerCase())) score += 5;
          if (text.includes(lic.name.toLowerCase())) score += 5;
          if (lic.id === "MIT" && text.includes("permission is hereby granted")) score += 10;
          if (lic.id === "Apache-2.0" && text.includes("apache license")) score += 10;
          if (lic.id.startsWith("GPL") && text.includes("gnu general public")) score += 10;
          if (lic.id === "ISC" && text.includes("isc license")) score += 10;
          if (lic.id === "BSD-2-Clause" && text.includes("bsd 2-clause")) score += 10;
          if (lic.id === "BSD-3-Clause" && text.includes("bsd 3-clause")) score += 10;
          if (score > 0) scores.push({ id: lic.id, score });
        }
        scores.sort((a, b) => b.score - a.score);
        return JSON.stringify({ detected: scores[0]?.id || null, candidates: scores.slice(0, 3) });
      }
      case "info": {
        const id = String(params.id || "").toUpperCase();
        const lic = LICENSES.find((l) => l.id.toUpperCase() === id);
        return lic ? JSON.stringify(lic) : JSON.stringify({ error: `unknown license: ${id}` });
      }
      case "compare": {
        const l1 = LICENSES.find((l) => l.id === String(params.id || ""));
        const l2 = LICENSES.find((l) => l.id === String(params.id2 || ""));
        if (!l1 || !l2) return JSON.stringify({ error: "license not found" });
        return JSON.stringify({
          license1: l1.id, license2: l2.id,
          both_osi: l1.osi && l2.osi,
          copyleft: { [l1.id]: l1.copyleft, [l2.id]: l2.copyleft },
          shared_permissions: l1.permissions.filter((p) => l2.permissions.includes(p)),
          shared_conditions: l1.conditions.filter((c) => l2.conditions.includes(c)),
        });
      }
      case "list": {
        return JSON.stringify({ count: LICENSES.length, licenses: LICENSES.map((l) => ({ id: l.id, name: l.name, osi: l.osi, copyleft: l.copyleft })) });
      }
      case "compatible": {
        const id = String(params.id || "");
        const lic = LICENSES.find((l) => l.id === id);
        if (!lic) return JSON.stringify({ error: `unknown license: ${id}` });
        const compatible = LICENSES.filter((l) => {
          if (l.id === id) return false;
          if (lic.copyleft && !l.copyleft) return true;
          if (!lic.copyleft && !l.copyleft) return true;
          if (lic.copyleft && l.copyleft && lic.id === l.id) return true;
          return false;
        }).map((l) => l.id);
        return JSON.stringify({ license: id, compatible });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
