import test from 'node:test';
import assert from 'node:assert/strict';
import { studioBriefingMarkdown } from '../src/render/ourplace-studio.js';
import { createOurplaceStudio } from '../src/domains/ourplace-studio.js';

test('downloaded briefing contains later source sections and original author credit', () => {
  const studio = createOurplaceStudio({ storage: null });
  const source = studio.importDocument({actor:'u:you',title:'Lighting notes',text:'# Direction\nCalm.\n# Geometry\nPreserve authored mesh.\n# Lighting\nUse soft cyan lighting.',license:'CC-BY',attribution:'Tumbo',origin:'Original notes'});
  studio.setAccess({actor:'u:you',documentId:source.id,visibility:'shared'});
  const project = studio.createProject({actor:'u:you',title:'Room',brief:'Make a calm room.',sourceIds:[source.id]});
  const markdown = studioBriefingMarkdown(studio.exportProject({actor:'u:you',projectId:project.id}));
  assert.match(markdown,/Use soft cyan lighting\./);
  assert.match(markdown,/Credit: Tumbo/);
  assert.match(markdown,/Lines 5–6/);
  assert.match(markdown,/No AI execution/);
});

test('source Markdown, HTML and long fence runs remain inside literal blocks', () => {
  const text = '```\n<script>doSomething()</script>\n' + '`'.repeat(1000);
  const markdown = studioBriefingMarkdown({project:{title:'Title',brief:text,tasks:[]},references:[]});
  assert.ok(markdown.includes('`'.repeat(1001) + 'text\n' + text));
  assert.match(markdown,/No AI execution/);
});
