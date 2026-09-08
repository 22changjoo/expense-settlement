/**
 * Drive 저장 — /경비정산시스템/영수증/YYYY/MM/, /경비정산시스템/입금캡처/YYYY/
 * 모든 폴더는 생성 직후 링크 공유를 해제해 본인 계정만 접근하도록 둡니다.
 */

function folder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  var f = parent.createFolder(name);
  try {
    f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (e) {
    // 개인 계정 기본값이 이미 비공개인 경우 무시합니다.
  }
  return f;
}

function rootFolder_() {
  return folder_(DriveApp.getRootFolder(), CFG.DRIVE_ROOT);
}

function receiptFolder_(useDate) {
  var d = ymd_(useDate);
  var year = d.slice(0, 4) || String(new Date().getFullYear());
  var month = d.slice(5, 7) || pad2_(new Date().getMonth() + 1);
  return folder_(folder_(folder_(rootFolder_(), CFG.DRIVE_RECEIPT), year), month);
}

function depositFolder_(depositDate) {
  var year = ymd_(depositDate).slice(0, 4) || String(new Date().getFullYear());
  return folder_(folder_(rootFolder_(), CFG.DRIVE_DEPOSIT), year);
}

/** base64 데이터를 Drive 에 저장하고 파일 URL 을 돌려줍니다. */
function saveImage_(folder, filename, base64, mimeType) {
  if (!base64) return '';
  var clean = String(base64).replace(/^data:[^;]+;base64,/, '');
  var blob = Utilities.newBlob(Utilities.base64Decode(clean), mimeType || 'image/jpeg', filename);
  var file = folder.createFile(blob);
  return file.getUrl();
}

function ext_(mimeType) {
  if (!mimeType) return 'jpg';
  if (mimeType.indexOf('png') >= 0) return 'png';
  if (mimeType.indexOf('webp') >= 0) return 'webp';
  if (mimeType.indexOf('heic') >= 0) return 'heic';
  return 'jpg';
}

function saveReceiptImage_(expenseId, useDate, base64, mimeType) {
  var name = expenseId + '_' + ymd_(useDate) + '.' + ext_(mimeType);
  return saveImage_(receiptFolder_(useDate), name, base64, mimeType);
}

function saveDepositImage_(settlementId, depositDate, base64, mimeType) {
  var name = settlementId + '_' + ymd_(depositDate) + '.' + ext_(mimeType);
  return saveImage_(depositFolder_(depositDate), name, base64, mimeType);
}

/** Drive 파일 URL 에서 파일 ID 를 뽑아 이미지 바이트를 base64 로 돌려줍니다(상세 화면 미리보기용). */
function fetchImageBase64_(url) {
  var m = String(url || '').match(/[-\w]{25,}/);
  if (!m) return null;
  var file = DriveApp.getFileById(m[0]);
  var blob = file.getBlob();
  return {
    mimeType: blob.getContentType(),
    data: Utilities.base64Encode(blob.getBytes())
  };
}
