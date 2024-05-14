const { assert } = require("chai");
const { checkSgStatus, handleSgResults } = require("../src");

describe("Test read subgraph", async function () {
    it("should check subgraph status", async function () {
        sgsUrls = [
            "url1",
            "url2"
        ];
        const blockNumberResult = {
            status: "fulfilled",
            reason: undefined,
            value: 123
        };
        const mockSgStatusOk = [
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            _meta: {
                                hasIndexingErrors: false,
                                block: { number: 123 }
                            }
                        }
                    }
                }
            },
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            _meta: {
                                hasIndexingErrors: false,
                                block: { number: 122 }
                            }
                        }
                    }
                }
            }
        ];
        let result;
        try {
            result = checkSgStatus(sgsUrls, mockSgStatusOk, blockNumberResult);
        } catch {
            throw "expected to resolve, but rejected";
        }
        assert.deepEqual(result.availableSgs, sgsUrls);
        assert.deepEqual(result.reasons, {});

        const mockSgStatusRejected = [
            {
                status: "rejected",
                reason: undefined,
                value: undefined
            },
            {
                status: "rejected",
                reason: undefined,
                value: undefined
            }
        ];
        try {
            checkSgStatus(sgsUrls, mockSgStatusRejected, blockNumberResult);
            throw "expected to reject, but resolved";
        } catch(error) {
            assert.equal(error, "unhealthy subgraph");
        }

        const mockSgStatusUndefined = [
            {
                status: "fulfilled",
                reason: undefined,
                value: undefined
            },
            {
                status: "fulfilled",
                reason: undefined,
                value: undefined
            }
        ];
        try {
            checkSgStatus(sgsUrls, mockSgStatusUndefined, blockNumberResult);
            throw "expected to reject, but resolved";
        } catch(error) {
            assert.equal(error, "unhealthy subgraph");
        }

        const mockSgStatusUndefinedPartial = [
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            _meta: {
                                hasIndexingErrors: false,
                                block: { number: 123 }
                            }
                        }
                    }
                }
            },
            {
                status: "fulfilled",
                reason: undefined,
                value: undefined
            }
        ];
        try {
            result = checkSgStatus(sgsUrls, mockSgStatusUndefinedPartial, blockNumberResult);
        } catch(error) {
            throw "expected to resolve, but rejected";
        }
        assert.deepEqual(result.reasons, { "url2": "did not receive valid status response" });
        assert.deepEqual(result.availableSgs, ["url1"]);


        const mockSgStatusIndexingError = [
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            _meta: {
                                hasIndexingErrors: true,
                                block: { number: 123 }
                            }
                        }
                    }
                }
            },
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            _meta: {
                                hasIndexingErrors: false,
                                block: { number: 123 }
                            }
                        }
                    }
                }
            }
        ];
        try {
            result = checkSgStatus(sgsUrls, mockSgStatusIndexingError, blockNumberResult);
        } catch(error) {
            throw "expected to resolve, but rejected";
        }
        assert.deepEqual(result.reasons, { "url1": "subgraph has indexing error" });
        assert.deepEqual(result.availableSgs, ["url2"]);

        const mockSgStatusOutOfSync = [
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            _meta: {
                                hasIndexingErrors: false,
                                block: { number: 12 }
                            }
                        }
                    }
                }
            },
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            _meta: {
                                hasIndexingErrors: false,
                                block: { number: 123 }
                            }
                        }
                    }
                }
            }
        ];
        try {
            result = checkSgStatus(sgsUrls, mockSgStatusOutOfSync, blockNumberResult);
        } catch(error) {
            throw "expected to resolve, but rejected";
        }
        assert.deepEqual(result.reasons, { "url1": "possibly out of sync" });
        assert.deepEqual(result.availableSgs, ["url2"]);

    });

    it("should return correct orders details", async function () {
        sgsUrls = [
            "url1",
            "url2"
        ];
        const mockSgResultOk = [
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            orders: [
                                "order1",
                                "order2"
                            ]
                        }
                    }
                }
            },
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            orders: [
                                "order3",
                                "order4"
                            ]
                        }
                    }
                }
            }
        ];
        let result;
        try {
            result = handleSgResults(sgsUrls, mockSgResultOk);
        } catch {
            throw "expected to resolve, but rejected";
        }
        assert.deepEqual(result, ["order1", "order2", "order3", "order4"]);

        const mockSgResultRejected = [
            {
                status: "rejected",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            orders: [
                                "order1",
                                "order2"
                            ]
                        }
                    }
                }
            },
            {
                status: "rejected",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            orders: [
                                "order3",
                                "order4"
                            ]
                        }
                    }
                }
            }
        ];
        try {
            handleSgResults(sgsUrls, mockSgResultRejected);
            throw "expected to resolve, but rejected";
        } catch(error) {
            assert.equal(error, "could not get order details from given sgs");
        }

        const mockSgResultPartial = [
            {
                status: "fulfilled",
                reason: undefined,
                value: {
                    data: {
                        data: {
                            orders: [
                                "order1",
                                "order2"
                            ]
                        }
                    }
                }
            },
            {
                status: "rejected",
                reason: undefined,
                value: undefined
            }
        ];
        try {
            result = handleSgResults(sgsUrls, mockSgResultPartial);
        } catch {
            throw "expected to resolve, but rejected";
        }
        assert.deepEqual(result, ["order1", "order2"]);
    });
});