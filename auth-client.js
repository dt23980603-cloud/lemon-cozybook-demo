(async()=>{
  const response=await fetch('/api/auth/me',{cache:'no-store'});
  if(!response.ok){location.replace(`/login.html?next=${encodeURIComponent(location.pathname+location.search)}`);return}
  const auth=await response.json();
  window.LEMON_AUTH=auth;
  document.documentElement.dataset.authRole=auth.role||'member';
  document.documentElement.dataset.authMemberId=auth.memberId||'';

  const adminSelectors={
    '/index.html':['#clearUpdatesBtn','#openFeaturedFlowerOptions','#toggleWebUpdateManage'],
    '/':['#clearUpdatesBtn','#openFeaturedFlowerOptions','#toggleWebUpdateManage'],
    '/page1.html':['#openZodiacManage'],
    '/page3.html':['a[href="page10.html"]'],
    '/page5.html':['#resetCompetitionMission','#openEditFlowerModal']
  };
  (adminSelectors[location.pathname]||[]).forEach(selector=>document.querySelectorAll(selector).forEach(element=>{
    element.dataset.adminOnly='true';
    if(auth.role!=='admin')element.hidden=true;
  }));
  document.querySelectorAll('[data-admin-only]').forEach(element=>{if(auth.role!=='admin')element.hidden=true});

  const style=document.createElement('style');
  style.textContent=`
    .lemon-account{position:fixed;right:12px;bottom:12px;z-index:10020;font-family:'Gowun Batang',serif}
    .lemon-account-toggle{display:flex;align-items:center;gap:5px;min-height:36px;padding:6px 10px;border:1px solid rgba(165,145,60,.55);border-radius:999px;background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(70,60,20,.12);color:#514829;font:700 .72rem 'Gowun Batang',serif;cursor:pointer}
    .lemon-account-menu{position:absolute;right:0;bottom:43px;display:none;min-width:185px;padding:9px;border:1px solid #ddcf91;border-radius:13px;background:#fff;box-shadow:0 9px 25px rgba(60,50,20,.18)}
    .lemon-account.open .lemon-account-menu{display:grid;gap:6px}.lemon-account-name{padding:5px 7px 8px;border-bottom:1px solid #eee6c8;font-size:.72rem;font-weight:700}
    .lemon-account-menu a,.lemon-account-menu button{display:block;width:100%;padding:7px 8px;border:0;border-radius:8px;background:#fff;text-align:left;color:#4f4935;text-decoration:none;font:inherit;font-size:.68rem;cursor:pointer}.lemon-account-menu a:hover,.lemon-account-menu button:hover{background:#fff8d8}
    @media(max-width:620px){.lemon-account{right:8px;bottom:8px}.lemon-account-toggle{min-height:32px;padding:5px 8px;font-size:.64rem}}
  `;
  document.head.appendChild(style);
  const account=document.createElement('div');account.className='lemon-account';
  account.innerHTML=`<button type="button" class="lemon-account-toggle" aria-expanded="false">👤 ${escapeText(auth.memberName)}${auth.role==='admin'?' · 관리자':''}</button><div class="lemon-account-menu"><div class="lemon-account-name">${escapeText(auth.memberName)}<br><small>${escapeText(auth.loginCode)}</small></div>${auth.role==='admin'?'<a href="/admin-accounts.html">⚙️ 길드원 · 계정 관리</a><a href="/page8.html">🌷 꽃 관리</a>':''}<a href="/change-pin.html">🔐 PIN 변경</a><button type="button" data-logout>↪ 로그아웃</button></div>`;
  document.body.appendChild(account);
  const toggle=account.querySelector('.lemon-account-toggle');toggle.addEventListener('click',()=>{const open=account.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open))});
  document.addEventListener('click',event=>{if(!account.contains(event.target)){account.classList.remove('open');toggle.setAttribute('aria-expanded','false')}});
  account.querySelector('[data-logout]').addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST'}).catch(()=>{});location.replace('/login.html')});
  window.dispatchEvent(new CustomEvent('lemon-auth-ready',{detail:auth}));
  function escapeText(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
})().catch(()=>location.replace('/login.html'));
