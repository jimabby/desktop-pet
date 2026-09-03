'use strict';

// The activity window. Everything it shows is data main already collects for
// the tray submenus — this just renders it as something you can actually read.
//
// All text here (assistant names, event messages) originates from whatever
// POSTed to the control server, so it is built with textContent and never
// interpolated into markup.

const $ = (id) => document.getElementById(id);
const EVENT_ICON = { confirm: '👀', error: '⚠️', done: '✅' };

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function renderChart(days) {
  const chart = $('chart');
  chart.replaceChildren();
  // Scale to the busiest day so a quiet week still reads as a shape, with a
  // floor of 1 so a week of zeroes doesn't divide by zero.
  const peak = Math.max(1, ...days.map((d) => d.tasks));
  const today = days.length ? days[days.length - 1].date : '';

  days.forEach((d) => {
    const col = document.createElement('div');
    col.className = 'day' + (d.date === today ? ' today' : '');
    col.title = `${d.date}: ${d.tasks} task${d.tasks === 1 ? '' : 's'}, ${fmtDur(d.activeMs)} active`;

    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = d.tasks ? String(d.tasks) : '';

    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${Math.round((d.tasks / peak) * 100)}%`;
    wrap.appendChild(bar);

    const label = document.createElement('div');
    label.className = 'd';
    label.textContent = d.label;

    col.append(n, wrap, label);
    chart.appendChild(col);
  });
}

function renderPerAi(rows) {
  const host = $('per-ai');
  host.replaceChildren();
  if (!rows.length) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = 'No activity yet today.';
    host.appendChild(p);
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  [
    ['Assistant', ''],
    ['Done', 'num'],
    ['Active', 'num'],
    ['Confirms', 'num'],
    ['Errors', 'num']
  ].forEach(([text, cls]) => {
    const th = document.createElement('th');
    if (cls) th.className = cls;
    th.textContent = text;
    hr.appendChild(th);
  });
  thead.appendChild(hr);

  const tbody = document.createElement('tbody');
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    const cells = [
      [r.name, ''],
      [String(r.tasks), 'num'],
      [fmtDur(r.activeMs), 'num'],
      [String(r.confirms), 'num'],
      [String(r.errors), 'num']
    ];
    cells.forEach(([text, cls]) => {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  host.appendChild(table);
}

function renderEvents(events) {
  const list = $('events');
  list.replaceChildren();
  if (!events.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing yet.';
    list.appendChild(li);
    return;
  }
  events.forEach((e) => {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${EVENT_ICON[e.kind] || '•'} ${e.name}`;
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = e.text;
    what.title = e.text;
    const ago = document.createElement('span');
    ago.className = 'ago';
    ago.textContent = e.ago;
    li.append(who, what, ago);
    list.appendChild(li);
  });
}

function render(data) {
  if (!data) return;
  $('week-tasks').textContent = String(data.totals.tasks);
  $('week-active').textContent = fmtDur(data.totals.activeMs);
  $('lifetime').textContent = String(data.lifetimeTasks);
  renderChart(data.days);
  renderPerAi(data.perAi);
  renderEvents(data.events);
}

window.statsAPI.onActivity(render);

(async () => {
  render(await window.statsAPI.get());
})();
