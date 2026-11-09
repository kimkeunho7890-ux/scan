// ===== Appwrite 설정 (Appwrite 콘솔에서 만든 ID와 똑같이 맞춰주세요) =====
window.APP_CONFIG = {
  endpoint:     'https://appwrite.kim-gwajang.com/v1',
  projectId:    'stockscan',      // Appwrite 프로젝트 ID

  // 비공개 버킷: 출고가 포함 기준재고 원본 (관리자만)
  bucketId:     'stocklist',
  baseFileId:   'base',
  lostFileId:   'lost',         // 분실 목록 (모델명, 일련번호, 기존분실건, 비고)

  // 공개 버킷: 로그인 없는 조사 화면이 읽는 파일 (출고가·주소·연락처 없음)
  publicBucketId: 'public',
  basePubFileId:  'base_pub',     // 기준재고 (POS코드, POS그룹명, POS닉네임, 단말모델, 일련번호, 단말색상)
  curPubFileId:   'current_pub',  // 현재재고 (같은 컬럼)
  storesFileId:   'stores',       // P코드, 판매점명 (자동완성)

  // 조사 결과 저장
  databaseId:   'scan',
  surveyCollectionId: 'surveys'
};