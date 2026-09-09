window.UPGRADE_EFFICIENCY_DEFAULTS = {
  "levels": [
    {
      "key": "lv10",
      "label": "10레벨 개량",
      "cost": 30
    },
    {
      "key": "lv13",
      "label": "13레벨 개량",
      "cost": 90
    },
    {
      "key": "lv16",
      "label": "16레벨 개량",
      "cost": 150
    }
  ],
  "grades": {
    "normal": {
      "label": "일반품",
      "icon": "images/guides/upgrade/grade-normal.webp"
    },
    "good": {
      "label": "양품",
      "icon": "images/guides/upgrade/grade-good.webp"
    },
    "superior": {
      "label": "우품",
      "icon": "images/guides/upgrade/grade-superior.webp"
    },
    "rare": {
      "label": "진품",
      "icon": "images/guides/upgrade/grade-rare.webp"
    },
    "epic": {
      "label": "극상품",
      "icon": "images/guides/upgrade/grade-epic.webp"
    },
    "perfect": {
      "label": "절품",
      "icon": "images/guides/upgrade/grade-perfect.webp"
    }
  },
  "sections": [
    {
      "key": "gold",
      "title": "꽃 골드 수익 증가",
      "note": "주민 주문, 손님 주문, 꽃 진열대 판매, 향실 특급 배송, 그룹 주문에 영향 · 골드 수익 = 주문 골드 × (진급 보너스 + 광고 제거 특권)",
      "rows": [
        {
          "grade": "normal",
          "values": [
            "6% ~ 9%",
            "8% ~ 9%",
            ""
          ],
          "uncertain": [
            true,
            true,
            false
          ]
        },
        {
          "grade": "good",
          "values": [
            "10% ~ 14%",
            "10% ~ 15%",
            "10% / 13 / 14 / 15"
          ],
          "uncertain": [
            true,
            false,
            true
          ]
        },
        {
          "grade": "superior",
          "values": [
            "15% ~ 20%",
            "16% ~ 25%",
            "17 / 18 ~ 25%"
          ],
          "uncertain": [
            true,
            true,
            false
          ]
        },
        {
          "grade": "rare",
          "values": [
            "",
            "26% ~ 30%",
            "26% ~ 32 / 39"
          ],
          "uncertain": [
            false,
            true,
            false
          ]
        },
        {
          "grade": "epic",
          "values": [
            "",
            "",
            "42% ~ 50%"
          ],
          "uncertain": [
            false,
            false,
            true
          ]
        }
      ]
    },
    {
      "key": "exp",
      "title": "꽃 경험치 수익 증가",
      "note": "주민 주문, 손님 주문, 꽃 진열대 판매, 향실 특급 배송, 그룹 주문에 영향 · 경험치 수익 = 주문 경험치 × (진급 보너스 + VIP 경험치 보너스)",
      "rows": [
        {
          "grade": "normal",
          "values": [
            "1% ~ 3%",
            "2% ~ 4%",
            ""
          ],
          "uncertain": [
            true,
            true,
            false
          ]
        },
        {
          "grade": "good",
          "values": [
            "4% ~ 8%",
            "5% ~ 8%",
            "4% / 5 / 7 / 8"
          ],
          "uncertain": [
            false,
            false,
            true
          ]
        },
        {
          "grade": "superior",
          "values": [
            "9% ~ 10%",
            "9% ~ 13%",
            "10 / 11 / 12"
          ],
          "uncertain": [
            true,
            true,
            false
          ]
        },
        {
          "grade": "rare",
          "values": [
            "",
            "14% ~ 15%",
            "14% ~ 20%"
          ],
          "uncertain": [
            false,
            true,
            true
          ]
        },
        {
          "grade": "epic",
          "values": [
            "",
            "",
            "21% ~ 25%"
          ],
          "uncertain": [
            false,
            false,
            true
          ]
        }
      ]
    },
    {
      "key": "interval",
      "title": "수확 간격 시간 감소",
      "note": "",
      "rows": [
        {
          "grade": "normal",
          "values": [
            "2% ~ 5%",
            "4% ~ 5%",
            ""
          ],
          "uncertain": [
            true,
            true,
            false
          ]
        },
        {
          "grade": "good",
          "values": [
            "6% ~ 8%",
            "6% ~ 13%",
            "8% ~"
          ],
          "uncertain": [
            false,
            false,
            true
          ]
        },
        {
          "grade": "superior",
          "values": [
            "9% ~ 10%",
            "14% ~ 15%",
            "10 / 12 / 16"
          ],
          "uncertain": [
            true,
            true,
            false
          ]
        },
        {
          "grade": "rare",
          "values": [
            "",
            "16% ~ 20%",
            "20%"
          ],
          "uncertain": [
            false,
            true,
            false
          ]
        },
        {
          "grade": "epic",
          "values": [
            "",
            "",
            "26% ~ 30%"
          ],
          "uncertain": [
            false,
            false,
            true
          ]
        }
      ]
    },
    {
      "key": "essenceChance",
      "title": "정수 드롭 확률 증가",
      "note": "",
      "rows": [
        {
          "grade": "normal",
          "values": [
            "1% ~ 3%",
            "2%~",
            ""
          ],
          "uncertain": [
            true,
            true,
            false
          ]
        },
        {
          "grade": "good",
          "values": [
            "4% ~ 7%",
            "6%",
            "4% ~ 8%"
          ],
          "uncertain": [
            true,
            false,
            true
          ]
        },
        {
          "grade": "superior",
          "values": [
            "8% ~ 10%",
            "10%~",
            "9% ~ 16%"
          ],
          "uncertain": [
            true,
            false,
            false
          ]
        },
        {
          "grade": "rare",
          "values": [
            "",
            "14 / 15%",
            "17% ~ 20%"
          ],
          "uncertain": [
            false,
            true,
            false
          ]
        },
        {
          "grade": "epic",
          "values": [
            "",
            "",
            "21% ~ 25%"
          ],
          "uncertain": [
            false,
            false,
            true
          ]
        }
      ]
    },
    {
      "key": "essenceCount",
      "title": "정수 드롭 수량 증가",
      "note": "",
      "rows": [
        {
          "grade": "superior",
          "values": [
            "1개",
            "1개",
            "1개"
          ],
          "uncertain": [
            false,
            false,
            false
          ]
        }
      ]
    },
    {
      "key": "harvestCount",
      "title": "수확 수량 증가",
      "note": "",
      "rows": [
        {
          "grade": "rare",
          "values": [
            "",
            "0개~1개",
            "0개~1개"
          ],
          "uncertain": [
            false,
            false,
            false
          ]
        },
        {
          "grade": "epic",
          "values": [
            "",
            "",
            "1개~2개"
          ],
          "uncertain": [
            false,
            false,
            false
          ]
        }
      ]
    },
    {
      "key": "guildPoints",
      "title": "길드 경쟁전 / 꽃 포인트 증가",
      "note": "",
      "rows": [
        {
          "grade": "perfect",
          "values": [
            "",
            "",
            "1~4점"
          ],
          "uncertain": [
            false,
            false,
            false
          ]
        }
      ]
    }
  ]
};
