import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BUCKET = 'korean-resources', LIMIT = 50 * 1024 * 1024;
const allowedExt = new Set(['hwp','hwpx','pdf','ppt','pptx','doc','docx','txt','md','png','jpg','jpeg','webp','xlsx','zip']);
let supabase, user = null, items = [], tab = 'all', areaNav = '', listMode = false, signingUp = false, loading = false, channel = null;

function notice(message, error = false) {
  const el = $('toast'); el.textContent = message; el.style.background = error ? '#963f38' : '#22392a';
  el.classList.remove('hidden'); clearTimeout(notice.timer); notice.timer = setTimeout(() => el.classList.add('hidden'), 4000);
}
function authNotice(message, error = false) {
  $('authMessage').textContent = message;
  $('authMessage').className = 'notice' + (error ? ' error' : '');
}
function setLoading(state) { loading = state; ['save','authSubmit','importBtn'].forEach(id => $(id).disabled = state); }
function dateText(value) { return new Date(value).toLocaleDateString('ko-KR'); }
function extension(name) { return (name || '').split('.').pop().toLowerCase(); }
function supportedFile(file) {
  if (file.size > LIMIT) throw Error('한 파일의 크기는 50MB를 넘을 수 없습니다.');
  if (!allowedExt.has(extension(file.name))) throw Error('지원하지 않는 파일 형식입니다.');
}
function safeFileName(name) { return name.replace(/[\x00-\x1f]/g,'').slice(0,220); }
function createPath(file) { return `${user.id}/${crypto.randomUUID()}.${extension(file.name)}`; }
async function uploadFile(file) {
  supportedFile(file);
  const path = createPath(file);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  return path;
}
async function removeFile(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
function makeBaseData() {
  return {
    title: $('title').value.trim(), grade: $('fgrade').value, area: $('farea').value,
    kind: $('fkind').value, unit: $('unit').value.trim(), notes: $('notes').value.trim(),
    tags: [...new Set($('tags').value.split(',').map(x => x.trim()).filter(Boolean))]
  };
}
async function refresh() {
  if (!user || loading) return;
  try {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('resources').select('*').order('updated_at', { ascending: false }).range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    items = all; render();
  } catch (e) { notice('목록을 불러오지 못했습니다: ' + e.message, true); }
}
function render() {
  const q = $('query').value.trim().toLocaleLowerCase(), grade = $('grade').value;
  const area = $('area').value || areaNav, kind = $('kind').value;
  let rows = items.filter(x => (!grade || x.grade === grade) && (!area || x.area === area) &&
    (!kind || x.kind === kind) && (tab !== 'favorite' || x.favorite) &&
    (!q || [x.title,x.grade,x.area,x.kind,x.unit,x.notes,x.file_name,...(x.tags || [])].join(' ').toLocaleLowerCase().includes(q)));
  rows.sort((a,b) => new Date(b[tab === 'recent' ? 'created_at':'updated_at']) - new Date(a[tab === 'recent' ? 'created_at':'updated_at']));
  $('total').textContent = items.length;
  $('favCount').textContent = items.filter(x => x.favorite).length;
  const now = new Date();
  $('monthCount').textContent = items.filter(x => { const d = new Date(x.created_at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).length;
  $('sectionTitle').textContent = areaNav ? areaNav + ' 자료' : tab === 'favorite' ? '즐겨찾기' : tab === 'recent' ? '최근 등록' : '전체 자료';
  $('resultCount').textContent = `${rows.length}개의 자료`;
  $('cards').className = listMode ? 'listview' : 'grid';
  $('view').textContent = listMode ? '▦ 카드 보기' : '☷ 목록 보기';
  $('cards').innerHTML = rows.length ? rows.map(x => {
    const ext = extension(x.file_name);
    const type = ext === 'pdf' ? 'pdf' : ['ppt','pptx'].includes(ext) ? 'ppt' : ['jpg','jpeg','png','webp'].includes(ext) ? 'img' : 'other';
    const symbol = type === 'pdf' ? 'PDF' : type === 'ppt' ? 'PPT' : type === 'img' ? 'IMG' : '文';
    return `<article class="item"><div class="thumb ${type}"><div class="fileIcon">${symbol}</div>
    <button type="button" class="favorite ${x.favorite ? 'on':''}" data-act="fav" data-id="${esc(x.id)}" aria-label="즐겨찾기">${x.favorite ? '★':'☆'}</button></div><div class="cardbody">
    <div class="meta">${esc(x.grade)} &nbsp; / &nbsp; ${esc(x.area)} &nbsp; / &nbsp; ${esc(x.kind)}</div>
    <h3>${esc(x.title)}</h3><div class="desc">${esc(x.unit || x.notes || '설명 없음')}<br>등록 ${esc(dateText(x.created_at))}</div>
    <div class="tags">${(x.tags || []).slice(0,5).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
    <div class="actions">${x.file_path ? `<button class="small" data-act="download" data-id="${esc(x.id)}">↓ 파일</button>` : ''}
    ${x.file_path && ['pdf','png','jpg','jpeg','webp'].includes(ext) ? `<button class="small" data-act="preview" data-id="${esc(x.id)}">미리보기</button>` : ''}
    <button class="small" data-act="edit" data-id="${esc(x.id)}">수정</button><button class="small" data-act="delete" data-id="${esc(x.id)}">삭제</button></div></div></article>`;
  }).join('') : `<div class="empty"><strong>${items.length ? '검색 결과가 없습니다.' : '아직 등록된 자료가 없습니다.'}</strong>${items.length ? '검색어나 필터를 바꿔 보세요.' : '자료 등록 버튼을 눌러 국어 자료를 추가하세요.'}</div>`;
}
function modal(show) {
  $('modalWrap').classList.toggle('open', show);
  if (!show) { $('form').reset(); $('editId').value = ''; $('fileState').textContent = 'PDF와 이미지는 미리보기가 가능합니다.'; }
}
function createRecord() { $('modalTitle').textContent = '새 자료 등록'; $('form').reset(); $('editId').value = ''; modal(true); }
function editRecord(x) {
  $('modalTitle').textContent = '자료 정보 수정'; $('editId').value = x.id;
  $('title').value = x.title; $('fgrade').value = x.grade; $('farea').value = x.area;
  $('fkind').value = x.kind; $('unit').value = x.unit || ''; $('notes').value = x.notes || '';
  $('tags').value = (x.tags || []).join(', ');
  $('fileState').textContent = x.file_name ? `기존 파일: ${x.file_name} (새 파일 선택 시 교체)` : '첨부 파일 없음';
  modal(true);
}
async function saveRecord(e) {
  e.preventDefault(); if (loading) return;
  const id = $('editId').value, old = items.find(x => x.id === id), file = $('file').files[0];
  if (file) { try { supportedFile(file); } catch (e) { notice(e.message,true); return; } }
  const data = makeBaseData(); if (!data.title) { notice('자료 제목을 입력하세요.',true); return; }
  setLoading(true); let newPath = null;
  try {
    if (file) {
      notice('파일을 클라우드에 업로드하고 있습니다…');
      newPath = await uploadFile(file);
      Object.assign(data, { file_path:newPath, file_name:safeFileName(file.name), file_type:file.type || '', file_size:file.size });
    }
    let result;
    if (old) result = await supabase.from('resources').update(data).eq('id', old.id).select('id').single();
    else result = await supabase.from('resources').insert({ ...data, user_id:user.id }).select('id').single();
    if (result.error) throw result.error;
    // 새로운 파일 연결이 성공한 뒤에만 기존 파일 제거. 실패하면 복구 가능한 고아 파일만 남음.
    if (newPath && old?.file_path) {
      try { await removeFile(old.file_path); } catch (_) { notice('새 파일은 저장됐지만 이전 파일 정리에 실패했습니다.',true); }
    }
    modal(false); await refresh(); notice('클라우드에 저장했습니다.');
  } catch (err) {
    if (newPath) { try { await removeFile(newPath); } catch (_) {} }
    notice('자료 저장 실패: ' + err.message, true);
  } finally { setLoading(false); }
}
async function previewOrDownload(x, mode) {
  const download = mode === 'download';
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(x.file_path, 60, download ? { download:x.file_name || true } : {});
  if (error) throw error;
  const anchor = document.createElement('a'); anchor.href = data.signedUrl;
  anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
  if (download) anchor.download = x.file_name || 'resource';
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
}
async function handleAction(e) {
  const btn = e.target.closest('button[data-act]'); if (!btn || loading) return;
  const x = items.find(row => row.id === btn.dataset.id); if (!x) return;
  try {
    if (btn.dataset.act === 'edit') return editRecord(x);
    if (btn.dataset.act === 'fav') {
      const { error } = await supabase.from('resources').update({ favorite:!x.favorite }).eq('id',x.id);
      if (error) throw error; await refresh();
    } else if (btn.dataset.act === 'delete') {
      if (!confirm(`'${x.title}' 자료를 삭제할까요?`)) return;
      const { error } = await supabase.from('resources').delete().eq('id',x.id);
      if (error) throw error;
      if (x.file_path) { try { await removeFile(x.file_path); } catch (_) { notice('자료 기록은 삭제됐지만 파일 정리가 필요합니다.',true); } }
      await refresh(); notice('자료를 삭제했습니다.');
    } else if (btn.dataset.act === 'download' || btn.dataset.act === 'preview') {
      await previewOrDownload(x,btn.dataset.act);
    }
  } catch (err) { notice('작업 실패: ' + err.message,true); }
}
function decodeLegacyFile(base64, mime, name) {
  const bytes = atob(base64), chunks = [];
  for (let i = 0; i < bytes.length; i += 32768) {
    const str = bytes.slice(i,i+32768), arr = new Uint8Array(str.length);
    for (let j=0;j<str.length;j++) arr[j]=str.charCodeAt(j);
    chunks.push(arr);
  }
  return new File(chunks, name, { type:mime || 'application/octet-stream' });
}
async function importLegacy(file) {
  if (!file) return;
  let legacy;
  try {
    legacy = JSON.parse(await file.text());
    if (legacy.format !== 'korean-teacher-archive-v1' || !Array.isArray(legacy.items)) throw Error('기존 자료실 JSON 백업이 아닙니다.');
  } catch (e) { notice('백업 파일 오류: ' + e.message,true); return; }
  if (!confirm(`${legacy.items.length}개의 이전 자료를 클라우드에 가져올까요? 동일 자료를 다시 가져오면 중복 등록됩니다.`)) return;
  setLoading(true); let success = 0, failures = 0;
  for (const x of legacy.items) {
    let path = null;
    try {
      if (!x.title) throw Error('제목 없음');
      const row = {
        user_id:user.id, title:String(x.title).slice(0,140),
        grade:['중1','중2','중3','공통'].includes(x.grade) ? x.grade:'공통',
        area:['문학','문법','읽기','쓰기','듣기·말하기','매체'].includes(x.area) ? x.area:'문학',
        kind:['학습지','수업 PPT','평가 문항','수업 지도안','참고 자료','기타'].includes(x.kind) ? x.kind:'기타',
        unit:String(x.unit || ''), notes:String(x.notes || ''), tags:Array.isArray(x.tags) ? x.tags.map(String):[], favorite:Boolean(x.favorite)
      };
      if (x.fileBase64 && x.fileName) {
        const legacyFile = decodeLegacyFile(x.fileBase64,x.fileType,x.fileName);
        path = await uploadFile(legacyFile);
        Object.assign(row,{file_path:path,file_name:safeFileName(x.fileName),file_type:legacyFile.type,file_size:legacyFile.size});
      }
      const { error } = await supabase.from('resources').insert(row);
      if (error) throw error;
      success++;
    } catch (e) {
      failures++; console.error('자료 가져오기 실패', x.title, e);
      if (path) { try { await removeFile(path); } catch (_) {} }
    }
  }
  setLoading(false); await refresh();
  notice(`가져오기 완료: ${success}개 성공, ${failures}개 실패${failures ? ' (개발자 콘솔 확인)' : ''}`, failures > 0);
}
function unbindRealtime() { if (channel && supabase) { supabase.removeChannel(channel); channel = null; } }
function bindRealtime() {
  unbindRealtime(); if (!user) return;
  channel = supabase.channel('resource-updates-' + user.id)
    .on('postgres_changes',{ event:'*',schema:'public',table:'resources',filter:`user_id=eq.${user.id}` },()=>refresh())
    .subscribe();
}
async function showUser(nextUser) {
  user = nextUser;
  $('authScreen').classList.toggle('hidden',!!user);
  $('app').classList.toggle('hidden',!user);
  if (user) { $('account').textContent = user.email || ''; await refresh(); bindRealtime(); }
  else { unbindRealtime(); items=[]; render(); }
}
async function submitAuth(e) {
  e.preventDefault(); if (!supabase || loading) return;
  const email = $('email').value.trim(), password = $('password').value;
  setLoading(true);
  try {
    let response;
    if (signingUp) response = await supabase.auth.signUp({email,password});
    else response = await supabase.auth.signInWithPassword({email,password});
    if (response.error) throw response.error;
    if (signingUp && !response.data.session) authNotice('가입 확인 메일을 보냈습니다. 이메일을 인증한 뒤 로그인하세요.');
    else if (response.data.user) await showUser(response.data.user);
  } catch (e) { authNotice('인증 실패: ' + e.message,true); }
  finally { setLoading(false); }
}
function setupEvents() {
  $('authForm').addEventListener('submit',submitAuth);
  $('toggleSignup').onclick = () => {
    signingUp = !signingUp; $('authSubmit').textContent = signingUp ? '회원가입':'로그인';
    $('toggleSignup').textContent = signingUp ? '로그인으로 돌아가기':'회원가입';
    $('authHint').textContent = signingUp ? '계정이 이미 있으신가요?':'계정이 없으신가요?';
    $('authMessage').classList.add('hidden');
  };
  $('logout').onclick = async () => { const { error } = await supabase.auth.signOut(); if (error) notice(error.message,true); else await showUser(null); };
  $('refresh').onclick = refresh;
  $('add').onclick = createRecord;
  $('close').onclick = $('cancel').onclick = () => modal(false);
  $('modalWrap').onclick = e => { if (e.target === $('modalWrap')) modal(false); };
  $('form').addEventListener('submit',saveRecord);
  $('cards').addEventListener('click',handleAction);
  ['query','grade','area','kind'].forEach(id => $(id).addEventListener(id === 'query' ? 'input':'change', render));
  document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click',() => {
    document.querySelectorAll('.nav').forEach(el => el.classList.remove('active'));
    btn.classList.add('active'); tab = btn.dataset.tab || 'all'; areaNav = btn.dataset.area || '';
    ['query','grade','area','kind'].forEach(id => $(id).value=''); render();
  }));
  $('view').onclick = () => { listMode = !listMode; render(); };
  $('file').onchange = e => { const f=e.target.files[0]; if (f) $('fileState').textContent = `${f.name} · ${(f.size/1024/1024).toFixed(2)}MB`; };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => { await importLegacy(e.target.files[0]); e.target.value=''; };
  // 다른 기기에서 수정한 내용도 탭으로 돌아왔을 때 재조회.
  document.addEventListener('visibilitychange',() => { if (!document.hidden && user) refresh(); });
}
async function main() {
  setupEvents();
  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(SUPABASE_URL) || SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR-')) {
    $('setupWarn').textContent = '클라우드 연결 전입니다. config.js에 Supabase 프로젝트 URL과 publishable 키를 입력하고, schema.sql을 실행하세요.';
    $('setupWarn').classList.remove('hidden'); $('authSubmit').disabled = true; return;
  }
  try {
    supabase = createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data,error} = await supabase.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') console.warn(error);
    await showUser(data?.user || null);
    supabase.auth.onAuthStateChange((event, session) => {
      // auth 이벤트에서 Supabase API 호출 대신 다음 작업 큐로 양도
      setTimeout(() => { if ((session?.user?.id || null) !== (user?.id || null)) showUser(session?.user || null); },0);
    });
  } catch (e) { $('setupWarn').textContent = '연결 초기화에 실패했습니다: ' + e.message; $('setupWarn').classList.remove('hidden'); }
}
main();
