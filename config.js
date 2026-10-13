// ===== Appwrite 설정 (Appwrite 콘솔에서 만든 ID와 똑같이 맞춰주세요) =====
window.APP_CONFIG = {
  endpoint:     'https://appwrite.kim-gwajang.com/v1',
  projectId:    'stockscan',      // Appwrite 프로젝트 ID

  // 비공개 버킷: 출고가 포함 원본 재고리스트 (관리자만)
  bucketId:     'stocklist',
  stockFileId:  'stocklist',

  // 공개 버킷: 로그인 없는 조사 화면이 읽는 파일 (가격·주소·연락처 없음)
  publicBucketId: 'public',
  pubStockFileId: 'stocklist_pub',  // 모델명, 일련번호
  storesFileId:   'stores',         // P코드, 판매점명

  // 조사 결과 저장
  databaseId:   'scan',
  surveyCollectionId: 'surveys'
};
