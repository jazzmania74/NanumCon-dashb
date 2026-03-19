/**
 * 나눔경영컨설팅 GA4 데이터 API
 * Google Apps Script Web App
 *
 * ── 설정 방법 ──────────────────────────────────────────────────
 * 1. GA4_PROPERTY_ID를 실제 GA4 프로퍼티 ID로 변경 (숫자만, 예: 123456789)
 *    → GA4 관리 > 속성 > 프로퍼티 ID에서 확인
 *
 * 2. 왼쪽 메뉴 "서비스" > + 클릭 > "Google Analytics Data API" 추가
 *
 * 3. 배포 > 새 배포 > 유형: 웹앱
 *    - 다음 사용자로 실행: 나 (내 계정)
 *    - 액세스 권한: 모든 사용자 (익명 포함)
 *    - "배포" 클릭 → 웹앱 URL 복사
 *
 * 4. 복사한 URL을 index.html 의 APPS_SCRIPT_URL 변수에 붙여넣기
 * ──────────────────────────────────────────────────────────────
 */

const GA4_PROPERTY_ID = '302777380';

// ─── 웹앱 진입점 ───────────────────────────────────────────────
function doGet(e) {
  const callback = e && e.parameter ? e.parameter.callback : null;
  let result;
  try {
    result = fetchAllGA4Data();
  } catch (err) {
    result = { error: err.toString() };
  }
  const json = JSON.stringify(result);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── GA4 전체 데이터 수집 ────────────────────────────────────
function fetchAllGA4Data() {
  const prop = 'properties/' + GA4_PROPERTY_ID;
  const curr = { startDate: '7daysAgo', endDate: 'yesterday' };
  const prev = { startDate: '14daysAgo', endDate: '8daysAgo' };

  // ── 1. KPI (현재 기간 + 이전 기간 비교) ──────────────────────
  const kpiResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr, prev],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'engagementRate' },
      { name: 'newUsers' },
      { name: 'screenPageViewsPerUser' },
      { name: 'averageSessionDuration' }
    ]
  }, prop);

  // dateRanges 2개일 때 rows[0]=현재, rows[1]=이전
  const cRow = (kpiResp.rows || [])[0] || { metricValues: Array(6).fill({ value: '0' }) };
  const pRow = (kpiResp.rows || [])[1] || { metricValues: Array(6).fill({ value: '0' }) };
  const cv = cRow.metricValues;
  const pv = pRow.metricValues;

  function chg(ci) {
    const c = parseFloat(cv[ci].value);
    const p = parseFloat(pv[ci].value);
    if (p === 0) return 0;
    return Math.round((c - p) / p * 1000) / 10;
  }

  const avgDur = parseFloat(cv[5].value);
  const newU   = parseFloat(cv[3].value);
  const actU   = parseFloat(cv[1].value);

  const kpi = {
    sessions:      Math.round(parseFloat(cv[0].value)),
    activeUsers:   Math.round(actU),
    engagementRate: Math.round(parseFloat(cv[2].value) * 100),
    newUsers:      Math.round(newU),
    newUserRate:   actU > 0 ? Math.round(newU / actU * 100) : 0,
    viewsPerUser:  Math.round(parseFloat(cv[4].value) * 10) / 10,
    avgSessionMin: Math.floor(avgDur / 60),
    avgSessionSec: Math.round(avgDur % 60),
    changes: {
      sessions:       chg(0),
      activeUsers:    chg(1),
      engagementRate: chg(2),
      newUsers:       chg(3),
      viewsPerUser:   chg(4),
      avgSessionTime: chg(5)
    }
  };

  // ── 2. 일별 트렌드 ────────────────────────────────────────────
  const trendResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'newUsers' }
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }]
  }, prop);

  const trend = { labels: [], sessions: [], active: [], newU: [] };
  (trendResp.rows || []).forEach(function(row) {
    const d = row.dimensionValues[0].value; // YYYYMMDD
    trend.labels.push(parseInt(d.slice(4, 6)) + '/' + parseInt(d.slice(6, 8)));
    trend.sessions.push(parseInt(row.metricValues[0].value));
    trend.active.push(parseInt(row.metricValues[1].value));
    trend.newU.push(parseInt(row.metricValues[2].value));
  });

  // ── 3. 디바이스 ───────────────────────────────────────────────
  const devResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'sessions' }]
  }, prop);

  const devMap = {};
  let devTotal = 0;
  (devResp.rows || []).forEach(function(row) {
    const v = parseInt(row.metricValues[0].value);
    devMap[row.dimensionValues[0].value.toLowerCase()] = v;
    devTotal += v;
  });
  const devices = {
    mobile:  devTotal > 0 ? Math.round((devMap.mobile  || 0) / devTotal * 1000) / 10 : 0,
    desktop: devTotal > 0 ? Math.round((devMap.desktop || 0) / devTotal * 1000) / 10 : 0,
    tablet:  devTotal > 0 ? Math.round((devMap.tablet  || 0) / devTotal * 1000) / 10 : 0
  };

  // ── 4. 이벤트 Top 10 ──────────────────────────────────────────
  const evtResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 10
  }, prop);

  const events = { labels: [], data: [] };
  (evtResp.rows || []).forEach(function(row) {
    events.labels.push(row.dimensionValues[0].value);
    events.data.push(parseInt(row.metricValues[0].value));
  });

  // ── 5. 국가 Top 6 ────────────────────────────────────────────
  const ctryResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr],
    dimensions: [{ name: 'country' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 6
  }, prop);

  const countries = { labels: [], data: [] };
  (ctryResp.rows || []).forEach(function(row) {
    countries.labels.push(row.dimensionValues[0].value);
    countries.data.push(parseInt(row.metricValues[0].value));
  });

  // ── 6. 트래픽 소스 Top 5 ─────────────────────────────────────
  const srcResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr],
    dimensions: [{ name: 'sessionSourceMedium' }],
    metrics: [{ name: 'eventCount' }],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 5
  }, prop);

  const sources = { labels: [], data: [] };
  (srcResp.rows || []).forEach(function(row) {
    sources.labels.push(row.dimensionValues[0].value);
    sources.data.push(parseInt(row.metricValues[0].value));
  });

  // ── 7. 도시 Top 7 ────────────────────────────────────────────
  const cityResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr],
    dimensions: [{ name: 'city' }],
    metrics: [{ name: 'eventCount' }],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 7
  }, prop);

  const cities = { labels: [], data: [] };
  (cityResp.rows || []).forEach(function(row) {
    cities.labels.push(row.dimensionValues[0].value);
    cities.data.push(parseInt(row.metricValues[0].value));
  });

  // ── 8. 랜딩 페이지 Top 15 ────────────────────────────────────
  const lpResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr],
    dimensions: [{ name: 'landingPagePlusQueryString' }],
    metrics: [{ name: 'sessions' }, { name: 'bounceRate' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 15
  }, prop);

  const landingPages = [];
  (lpResp.rows || []).forEach(function(row) {
    let path = row.dimensionValues[0].value;
    if (!path.startsWith('/')) path = '/' + path;
    path = path.split('?')[0]; // 쿼리스트링 제거
    landingPages.push({
      path: path,
      sessions: parseInt(row.metricValues[0].value),
      bounce: Math.round(parseFloat(row.metricValues[1].value) * 1000) / 10
    });
  });

  // ── 9. 페이지뷰 Top 15 ───────────────────────────────────────
  const pvResp = AnalyticsData.Properties.runReport({
    dateRanges: [curr],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 15
  }, prop);

  const pageViews = [];
  (pvResp.rows || []).forEach(function(row) {
    let path = row.dimensionValues[0].value;
    path = path.split('?')[0];
    pageViews.push({
      path: path,
      views: parseInt(row.metricValues[0].value),
      users: parseInt(row.metricValues[1].value)
    });
  });

  // ── 10. Ecommerce (generate_lead 이전 기간 비교) ─────────────
  const glIdx    = events.labels.indexOf('generate_lead');
  const ecomCurr = glIdx >= 0 ? events.data[glIdx] : 0;

  const prevGlResp = AnalyticsData.Properties.runReport({
    dateRanges: [prev],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { matchType: 'EXACT', value: 'generate_lead' }
      }
    }
  }, prop);

  const ecomPrev   = (prevGlResp.rows && prevGlResp.rows.length > 0)
    ? parseInt(prevGlResp.rows[0].metricValues[0].value) : 1;
  const ecomChange = ecomPrev > 0
    ? Math.round((ecomCurr - ecomPrev) / ecomPrev * 1000) / 10 : 0;

  // ── 날짜 범위 문자열 ──────────────────────────────────────────
  const now  = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const s7   = new Date(yest); s7.setDate(yest.getDate() - 6);
  const y1 = s7.getFullYear(), m1 = s7.getMonth() + 1, d1 = s7.getDate();
  const y2 = yest.getFullYear(), m2 = yest.getMonth() + 1, d2 = yest.getDate();
  let dateRangeStr;
  if (y1 === y2 && m1 === m2) dateRangeStr = y1 + '. ' + m1 + '. ' + d1 + '. ~ ' + m2 + '. ' + d2 + '.';
  else if (y1 === y2)          dateRangeStr = y1 + '. ' + m1 + '. ' + d1 + '. ~ ' + m2 + '. ' + d2 + '.';
  else                         dateRangeStr = y1 + '. ' + m1 + '. ' + d1 + '. ~ ' + y2 + '. ' + m2 + '. ' + d2 + '.';

  return {
    dateRange:   dateRangeStr,
    kpi:         kpi,
    trend:       trend,
    devices:     devices,
    events:      events,
    countries:   countries,
    sources:     sources,
    cities:      cities,
    landingPages: landingPages,
    pageViews:   pageViews,
    ecom:        { total: ecomCurr, change: ecomChange }
  };
}
