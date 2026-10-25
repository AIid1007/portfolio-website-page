// About: rotating "R is…" line and the enquiry form.
(() => {
  const { lines } = JSON.parse(document.getElementById('about-data').textContent);
  const rot = document.querySelector('.rot');
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  let i = 0;
  if (rot && lines.length > 1) {
    setInterval(() => {
      if (still.matches || document.hidden) return; // rotation pauses for reduced motion
      rot.classList.add('out');
      setTimeout(() => {
        i = (i + 1) % lines.length;
        rot.textContent = lines[i];
        rot.classList.remove('out');
      }, 450);
    }, 2800);
  }

  // ---------- enquiry form ----------
  const form = document.querySelector('.enquiry');
  if (!form) return;
  const status = form.querySelector('.status');
  const send = form.querySelector('.send');
  const { provider, id, email: owner } = form.dataset;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const say = (msg, kind, html) => {
    status.className = `status ${kind || ''}`;
    if (html) status.innerHTML = msg; else status.textContent = msg;
  };
  const fallback = () => (owner
    ? `Please email me directly at <a href="mailto:${owner}">${owner}</a>.`
    : 'Please reach me on Instagram for now.');

  form.addEventListener('input', (e) => e.target.removeAttribute('aria-invalid'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const v = { name: f.name.value.trim(), email: f.email.value.trim(), shoot: f.shoot.value, message: f.message.value.trim() };
    const problems = [];
    if (!v.name) problems.push([f.name, 'Please add your name.']);
    if (!EMAIL.test(v.email)) problems.push([f.email, 'Please check your email address.']);
    if (!v.message) problems.push([f.message, 'Tell me a little about the shoot.']);
    [f.name, f.email, f.message].forEach((el) => el.removeAttribute('aria-invalid'));
    if (problems.length) {
      problems.forEach(([el]) => el.setAttribute('aria-invalid', 'true'));
      problems[0][0].focus();
      say(problems.map((p) => p[1]).join(' '), 'err');
      return;
    }
    if (f.company.value) { say('Thank you. Your note is on its way.', 'ok'); form.reset(); return; } // honeypot: bots get a fake success

    const subject = `Shoot enquiry: ${v.shoot}`;
    if (!provider) {
      if (!owner) { say(`The form isn't connected yet. ${fallback()}`, 'err', true); return; }
      const bodyText = `${v.message}\n\nShoot type: ${v.shoot}\nFrom: ${v.name} <${v.email}>`;
      location.href = `mailto:${owner}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
      say(`Your email app should open with the message ready. If it doesn't, write to <a href="mailto:${owner}">${owner}</a>.`, 'ok', true);
      return;
    }

    send.disabled = true;
    send.textContent = 'sending…';
    try {
      let res;
      if (provider === 'formspree') {
        res = await fetch(`https://formspree.io/f/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, _subject: subject, _replyto: v.email }),
        });
      } else if (provider === 'web3forms') {
        res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_key: id, subject, from_name: v.name, ...v }),
        });
      } else throw new Error('unknown provider');
      if (!res.ok) throw new Error(String(res.status));
      say('Thank you. Your note is on its way, and I will reply soon.', 'ok');
      form.reset();
    } catch {
      say(`Something went wrong sending that. ${fallback()}`, 'err', true);
    } finally {
      send.disabled = false;
      send.textContent = 'send enquiry';
    }
  });
})();
