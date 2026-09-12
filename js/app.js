// Point this at your deployed backend (e.g. Render URL) before going live.
const API_BASE = window.TCA_API_BASE || 'http://localhost:4000/api';

const categoryList = document.getElementById('categoryList');
const nomineeSection = document.getElementById('nominees');
const categoriesSection = document.getElementById('categories');
const nomineeList = document.getElementById('nomineeList');
const nomineeCategoryTitle = document.getElementById('nomineeCategoryTitle');
const resultsList = document.getElementById('resultsList');

let selectedNomineeId = null;
let currentTransactionId = null;
let pollTimer = null;
let categoriesCache = [];
let currentCategoryId = null;
let currentCategoryIsFree = false;
let currentCategoryClosed = false;

let countdownTimer = null;

function startCountdowns() {
  clearInterval(countdownTimer);
  tickCountdowns();
  countdownTimer = setInterval(tickCountdowns, 1000);
}

function tickCountdowns() {
  document.querySelectorAll('.countdown[data-ends]').forEach(el => {
    const diff = new Date(el.dataset.ends).getTime() - Date.now();
    if (diff <= 0) {
      el.textContent = 'Voting closed';
      el.classList.add('countdown-closed');
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `${d}D ${h}H ${m}m ${s}S`;
  });
}

async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/categories`);
    const categories = await res.json();
    categoriesCache = categories;

    if (!categories.length) {
      categoryList.innerHTML = '<p class="muted">No categories open for voting yet.</p>';
      return;
    }

    const sections = {};
    categories.forEach(cat => {
      const key = cat.section || 'other';
      if (!sections[key]) sections[key] = [];
      sections[key].push(cat);
    });

    const sectionLabel = key => key.charAt(0).toUpperCase() + key.slice(1);

    categoryList.innerHTML = Object.entries(sections).map(([section, cats]) => `
      <div class="section-group">
        <h3 class="section-heading">${sectionLabel(section)}</h3>
        <div class="category-grid">
          ${cats.map(cat => `
            <div class="category-card" data-id="${cat.id}" data-name="${cat.name}" data-section="${cat.section}">
              <h3>${cat.name}</h3>
              ${cat.is_free_today ? '<span class="free-tag">Free voting today!</span>' : ''}
              ${cat.voting_ends_at ? `<div class="countdown" data-ends="${cat.voting_ends_at}">--</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    startCountdowns();

    categoryList.querySelectorAll('.category-card').forEach(card => {
      card.addEventListener('click', () => openCategory(card.dataset.id, card.dataset.name, card.dataset.section));
    });
  } catch (err) {
    categoryList.innerHTML = '<p class="muted">Could not load categories. Please refresh.</p>';
  }
}

async function openCategory(categoryId, categoryName, section) {
  categoriesSection.classList.add('hidden');
  nomineeSection.classList.remove('hidden');
  nomineeCategoryTitle.textContent = categoryName;
  nomineeList.innerHTML = '<p class="muted">Loading nominees…</p>';

  currentCategoryId = categoryId;
  const cachedCat = categoriesCache.find(c => c.id === categoryId);
  currentCategoryIsFree = Boolean(cachedCat?.is_free_today);
  currentCategoryClosed = Boolean(cachedCat?.voting_ends_at && new Date(cachedCat.voting_ends_at) <= new Date());

  const banner = document.getElementById('freeDayBanner');
  if (currentCategoryClosed) {
    banner.innerHTML = '⏱️ <strong>Voting has closed</strong> for this category.';
    banner.classList.remove('hidden');
  } else if (currentCategoryIsFree) {
    banner.innerHTML = '🎉 <strong>Free Voting Day!</strong> Voting in this category is free today — thanks to a sponsor.';
    banner.classList.remove('hidden');
  } else {
    banner.innerHTML = '';
    banner.classList.add('hidden');
  }

  const res = await fetch(`${API_BASE}/categories/${categoryId}/nominees`);
  const nominees = await res.json();

  nomineeList.innerHTML = nominees.map(n => `
    <div class="nominee-card">
      <img class="nominee-photo" src="${n.photo_url || 'https://placehold.co/400x300?text=Photo'}" alt="${n.full_name}" />
      <div class="nominee-body">
        <h4>${n.full_name}</h4>
        <p class="nominee-org">${n.organization || ''}${n.organization && n.county ? ' · ' : ''}${n.county || ''}</p>
        <p class="vote-count-line">${n.vote_count} vote${n.vote_count === 1 ? '' : 's'} so far</p>
        <button class="btn btn-primary btn-block" data-id="${n.id}" data-name="${n.full_name}" ${currentCategoryClosed ? 'disabled' : ''}>
          ${currentCategoryClosed ? 'Voting closed' : currentCategoryIsFree ? `Vote free for ${n.full_name.split(' ')[0]}` : `Vote for ${n.full_name.split(' ')[0]}`}
        </button>
      </div>
    </div>
  `).join('');

  nomineeList.querySelectorAll('button[data-id]:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => openVoteModal(btn.dataset.id, btn.dataset.name));
  });
}

document.getElementById('backToCategories').addEventListener('click', () => {
  nomineeSection.classList.add('hidden');
  categoriesSection.classList.remove('hidden');
});

// ---- Vote modal ----
const voteModal = document.getElementById('voteModal');
const voteModalName = document.getElementById('voteModalName');
const voteCountInput = document.getElementById('voteCount');
const voteTotal = document.getElementById('voteTotal');
const votePhone = document.getElementById('votePhone');
const voteStatus = document.getElementById('voteStatus');
const submitVoteBtn = document.getElementById('submitVote');
let submitVoteBtnLabel = submitVoteBtn.textContent;
const VOTE_PRICE = 20;

function setButtonLoading(isLoading, label) {
  submitVoteBtn.disabled = isLoading;
  submitVoteBtn.classList.toggle('btn-loading', isLoading);
  submitVoteBtn.textContent = isLoading ? (label || 'Sending…') : submitVoteBtnLabel;
}

function openVoteModal(nomineeId, name) {
  selectedNomineeId = nomineeId;
  voteModalName.textContent = `Vote for ${name}`;
  voteCountInput.value = 1;
  votePhone.value = '';
  voteStatus.textContent = '';
  voteStatus.className = 'vote-status';
  setButtonLoading(false);
  updateTotal();
  submitVoteBtnLabel = currentCategoryIsFree ? 'Confirm Free Vote' : 'Pay with M-Pesa';
  submitVoteBtn.textContent = submitVoteBtnLabel;
  voteModal.classList.remove('hidden');
}

function updateTotal() {
  const count = Math.max(1, parseInt(voteCountInput.value, 10) || 1);
  voteTotal.textContent = currentCategoryIsFree ? 'FREE today' : `KSh ${count * VOTE_PRICE}`;
}
voteCountInput.addEventListener('input', updateTotal);

document.getElementById('closeModal').addEventListener('click', () => {
  clearInterval(pollTimer);
  voteModal.classList.add('hidden');
});

submitVoteBtn.addEventListener('click', async () => {
  const votes = Math.max(1, parseInt(voteCountInput.value, 10) || 1);
  const phone = votePhone.value.trim();

  if (!/^0(7|1)\d{8}$/.test(phone) && !/^254(7|1)\d{8}$/.test(phone)) {
    setStatus('Enter a valid Safaricom number, e.g. 07XXXXXXXX', 'error');
    return;
  }

  setButtonLoading(true, 'Sending prompt…');
  setStatus('Sending M-Pesa prompt to your phone…', '');

  try {
    const res = await fetch(`${API_BASE}/payments/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomineeId: selectedNomineeId, phone, votes })
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || 'Something went wrong. Please try again.', 'error');
      setButtonLoading(false);
      return;
    }

    if (data.free) {
      setStatus(data.message, 'success');
      setButtonLoading(false);
      loadResults();
      loadCategories();
      return;
    }

    currentTransactionId = data.transactionId;
    setButtonLoading(true, 'Waiting for payment…');
    setStatus(data.pending
      ? data.message
      : 'Check your phone and enter your M-Pesa PIN to complete the vote.', '');
    pollPaymentStatus();
  } catch (err) {
    setStatus('Network error. Please try again.', 'error');
    setButtonLoading(false);
  }
});

function pollPaymentStatus() {
  let attempts = 0;
  pollTimer = setInterval(async () => {
    attempts += 1;
    if (attempts > 5) { // ~18s — Paystack resolves quickly, no cold-start to wait out
      clearInterval(pollTimer);
      setStatus('Still waiting on confirmation. If you completed payment, your vote will be credited automatically once it clears — no need to pay again.', '');
      setButtonLoading(false);
      return;
    }

    const res = await fetch(`${API_BASE}/payments/status/${currentTransactionId}`);
    const data = await res.json();

    if (data.status === 'success') {
      clearInterval(pollTimer);
      setStatus(`Thank you! ${data.votes_requested} vote(s) recorded.`, 'success');
      setButtonLoading(false);
      loadResults();
    } else if (data.status === 'failed') {
      clearInterval(pollTimer);
      setStatus('Payment was not completed. No votes were recorded.', 'error');
      setButtonLoading(false);
    }
  }, 3000);
}

function setStatus(msg, type) {
  voteStatus.textContent = msg;
  voteStatus.className = `vote-status ${type}`;
}

// ---- Public results ----
async function loadResults() {
  const res = await fetch(`${API_BASE}/results`);
  const results = await res.json();

  if (!results.length) {
    resultsList.innerHTML = '<p class="muted">No results yet.</p>';
    return;
  }

  resultsList.innerHTML = results.map(r => `
    <div class="result-category">
      <h3>${r.category.name}</h3>
      <p class="result-total">${r.total_votes} total vote${r.total_votes === 1 ? '' : 's'}</p>
      ${r.nominees.map(n => `
        <div class="result-row">
          <span class="result-name">${n.full_name}</span>
          <span class="result-bar-track"><span class="result-bar-fill" style="width:${n.percentage}%"></span></span>
          <span class="result-pct">${n.percentage}%</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ---- Apply for Nomination ----
loadCategories();
loadResults();
setInterval(loadResults, 15000); // keep the public leaderboard fresh

const nominationModal = document.getElementById('nominationModal');
const nomName = document.getElementById('nomName');
const nomCategory = document.getElementById('nomCategory');
const nomEmail = document.getElementById('nomEmail');
const nomPhone = document.getElementById('nomPhone');
const nomWhatsapp = document.getElementById('nomWhatsapp');
const nominationStatus = document.getElementById('nominationStatus');
const submitNominationBtn = document.getElementById('submitNomination');
let submitNominationBtnLabel = submitNominationBtn.textContent;

function setNominationButtonLoading(isLoading, label) {
  submitNominationBtn.disabled = isLoading;
  submitNominationBtn.classList.toggle('btn-loading', isLoading);
  submitNominationBtn.textContent = isLoading ? (label || 'Submitting…') : submitNominationBtnLabel;
}

function openNominationModal(preselectCategoryId) {
  nomName.value = '';
  nomEmail.value = '';
  nomPhone.value = '';
  nomWhatsapp.value = '';
  nominationStatus.textContent = '';
  nominationStatus.className = 'vote-status';
  setNominationButtonLoading(false);

  nomCategory.innerHTML = categoriesCache
    .map(cat => `<option value="${cat.id}">${cat.name}</option>`)
    .join('');

  if (preselectCategoryId) nomCategory.value = preselectCategoryId;

  nominationModal.classList.remove('hidden');
}

document.getElementById('applyNominationBtn').addEventListener('click', () => openNominationModal());
document.getElementById('applyNominationBtnInCategory').addEventListener('click', () => openNominationModal(currentCategoryId));

document.getElementById('closeNominationModal').addEventListener('click', () => {
  clearInterval(nominationPollTimer);
  nominationModal.classList.add('hidden');
});

document.getElementById('giveUpNomination').addEventListener('click', () => {
  clearInterval(nominationPollTimer);
  nominationModal.classList.add('hidden');
});

let nominationPollTimer = null;
let currentApplicationId = null;

submitNominationBtn.addEventListener('click', async () => {
  const fullName = nomName.value.trim();
  const email = nomEmail.value.trim();
  const phone = nomPhone.value.trim();
  const whatsapp = nomWhatsapp.value.trim();
  const categoryId = nomCategory.value;

  if (!fullName) {
    nominationStatus.textContent = 'Enter your full name';
    nominationStatus.className = 'vote-status error';
    return;
  }
  if (!/^0(7|1)\d{8}$/.test(phone) && !/^254(7|1)\d{8}$/.test(phone)) {
    nominationStatus.textContent = 'Enter a valid Safaricom number, e.g. 07XXXXXXXX';
    nominationStatus.className = 'vote-status error';
    return;
  }
  if (!/^0(7|1)\d{8}$/.test(whatsapp) && !/^254(7|1)\d{8}$/.test(whatsapp)) {
    nominationStatus.textContent = 'Enter a valid WhatsApp number, e.g. 07XXXXXXXX';
    nominationStatus.className = 'vote-status error';
    return;
  }

  setNominationButtonLoading(true, 'Sending prompt…');
  nominationStatus.textContent = 'Sending M-Pesa prompt to your phone…';
  nominationStatus.className = 'vote-status';

  try {
    const res = await fetch(`${API_BASE}/nominations/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email: email || undefined, phone, whatsapp, categoryId })
    });
    const data = await res.json();

    if (!res.ok) {
      nominationStatus.textContent = data.error || 'Something went wrong. Please try again.';
      nominationStatus.className = 'vote-status error';
      setNominationButtonLoading(false);
      return;
    }

    currentApplicationId = data.applicationId;
    setNominationButtonLoading(true, 'Waiting for payment…');
    nominationStatus.textContent = data.pending
      ? data.message
      : 'Check your phone and enter your M-Pesa PIN to pay the KSh 200 application fee.';
    pollApplicationStatus();
  } catch (err) {
    nominationStatus.textContent = 'Network error. Please try again.';
    nominationStatus.className = 'vote-status error';
    setNominationButtonLoading(false);
  }
});

function pollApplicationStatus() {
  let attempts = 0;
  nominationPollTimer = setInterval(async () => {
    attempts += 1;
    if (attempts > 5) { // ~18s — Paystack resolves quickly, no cold-start to wait out
      clearInterval(nominationPollTimer);
      nominationStatus.textContent = 'Still waiting on confirmation. If you completed payment, your application will go through automatically once it clears.';
      nominationStatus.className = 'vote-status';
      setNominationButtonLoading(false);
      return;
    }

    const res = await fetch(`${API_BASE}/nominations/status/${currentApplicationId}`);
    const data = await res.json();

    if (data.payment_status === 'success') {
      clearInterval(nominationPollTimer);
      nominationStatus.textContent = 'Payment received! Your application has been submitted for review.';
      nominationStatus.className = 'vote-status success';
      setNominationButtonLoading(false);
    } else if (data.payment_status === 'failed') {
      clearInterval(nominationPollTimer);
      nominationStatus.textContent = 'Payment was not completed. Your application was not submitted.';
      nominationStatus.className = 'vote-status error';
      setNominationButtonLoading(false);
    }
  }, 3000);
}

// ---- Sponsor Free Voting Day ----
const sponsorModal = document.getElementById('sponsorModal');
const sponsorCategoryLabel = document.getElementById('sponsorCategoryLabel');
const sponsorDaysInput = document.getElementById('sponsorDays');
const sponsorTotal = document.getElementById('sponsorTotal');
const sponsorPhone = document.getElementById('sponsorPhone');
const sponsorStatus = document.getElementById('sponsorStatus');
const submitSponsorBtn = document.getElementById('submitSponsor');
let submitSponsorBtnLabel = submitSponsorBtn.textContent;
const SPONSOR_DAY_PRICE = 50000;
let sponsorPollTimer = null;
let currentSponsorshipId = null;

function setSponsorButtonLoading(isLoading, label) {
  submitSponsorBtn.disabled = isLoading;
  submitSponsorBtn.classList.toggle('btn-loading', isLoading);
  submitSponsorBtn.textContent = isLoading ? (label || 'Sending…') : submitSponsorBtnLabel;
}

function updateSponsorTotal() {
  const days = Math.max(1, parseInt(sponsorDaysInput.value, 10) || 1);
  sponsorTotal.textContent = `KSh ${(days * SPONSOR_DAY_PRICE).toLocaleString()}`;
}
sponsorDaysInput.addEventListener('input', updateSponsorTotal);

document.getElementById('sponsorDayBtn').addEventListener('click', () => {
  if (!currentCategoryId) return;
  sponsorCategoryLabel.textContent = nomineeCategoryTitle.textContent;
  sponsorDaysInput.value = 1;
  sponsorPhone.value = '';
  sponsorStatus.textContent = '';
  sponsorStatus.className = 'vote-status';
  setSponsorButtonLoading(false);
  updateSponsorTotal();
  sponsorModal.classList.remove('hidden');
});

document.getElementById('closeSponsorModal').addEventListener('click', () => {
  clearInterval(sponsorPollTimer);
  sponsorModal.classList.add('hidden');
});

function setSponsorStatus(msg, type) {
  sponsorStatus.textContent = msg;
  sponsorStatus.className = `vote-status ${type}`;
}

submitSponsorBtn.addEventListener('click', async () => {
  const days = Math.max(1, parseInt(sponsorDaysInput.value, 10) || 1);
  const phone = sponsorPhone.value.trim();

  if (!/^0(7|1)\d{8}$/.test(phone) && !/^254(7|1)\d{8}$/.test(phone)) {
    setSponsorStatus('Enter a valid Safaricom number, e.g. 07XXXXXXXX', 'error');
    return;
  }

  setSponsorButtonLoading(true, 'Sending prompt…');
  setSponsorStatus('Sending M-Pesa prompt to your phone…', '');

  try {
    const res = await fetch(`${API_BASE}/sponsorship/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: currentCategoryId, days, phone })
    });
    const data = await res.json();

    if (!res.ok) {
      setSponsorStatus(data.error || 'Something went wrong. Please try again.', 'error');
      setSponsorButtonLoading(false);
      return;
    }

    currentSponsorshipId = data.sponsorshipId;
    setSponsorButtonLoading(true, 'Waiting for payment…');
    setSponsorStatus(data.pending
      ? data.message
      : 'Check your phone and enter your M-Pesa PIN to complete the sponsorship.', '');
    pollSponsorshipStatus();
  } catch (err) {
    setSponsorStatus('Network error. Please try again.', 'error');
    setSponsorButtonLoading(false);
  }
});

function pollSponsorshipStatus() {
  let attempts = 0;
  sponsorPollTimer = setInterval(async () => {
    attempts += 1;
    if (attempts > 5) { // ~18s — Paystack resolves quickly, no cold-start to wait out
      clearInterval(sponsorPollTimer);
      setSponsorStatus('Still waiting on confirmation. If you completed payment, the free voting day will start automatically once it clears.', '');
      setSponsorButtonLoading(false);
      return;
    }

    const res = await fetch(`${API_BASE}/sponsorship/status/${currentSponsorshipId}`);
    const data = await res.json();

    if (data.status === 'success') {
      clearInterval(sponsorPollTimer);
      setSponsorStatus(`Thank you! Voting is now free for this category for the next ${data.days} day(s).`, 'success');
      setSponsorButtonLoading(false);
      loadCategories();
      if (currentCategoryId) openCategory(currentCategoryId, nomineeCategoryTitle.textContent);
    } else if (data.status === 'failed') {
      clearInterval(sponsorPollTimer);
      setSponsorStatus('Payment was not completed. Sponsorship was not activated.', 'error');
      setSponsorButtonLoading(false);
    }
  }, 3000);
}
