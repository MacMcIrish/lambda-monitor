const Aws = require('aws-sdk-wrap');

module.exports = (options) => {
  const aws = Aws({ config: options });

  const logGroupName = (fn) => `/aws/lambda/${fn.FunctionName}`;

  const getAllFunctions = (reqOptions = {}) => aws
    .call('ResourceGroupsTaggingAPI:getResources', {
      ...reqOptions,
      ResourceTypeFilters: ['lambda'],
      ResourcesPerPage: 100
    })
    .then((data) => {
      const result = data.ResourceTagMappingList.map((r) => ({
        FunctionARN: r.ResourceARN,
        FunctionName: r.ResourceARN.substring(r.ResourceARN.lastIndexOf(':') + 1, r.ResourceARN.length),
        Tags: r.Tags.reduce((p, e) => Object.assign(p, ({ [e.Key]: e.Value })), {})
      }));
      if (data.PaginationToken === '') {
        return result;
      }
      return getAllFunctions({
        ...reqOptions,
        PaginationToken: data.PaginationToken
      })
        .then((resultList) => resultList.concat(result));
    });

  const appendLogRetentionInfo = (fns) => Promise.all(
    fns.map((fn) => aws
      .call('CloudWatchLogs:describeLogGroups', { logGroupNamePrefix: logGroupName(fn) })
      .then((r) => ({
        logGroups: r.logGroups.filter((e) => e.logGroupName === logGroupName(fn)),
        ...fn
      }))
      .catch((err) => {
        if (err.code === 'ResourceNotFoundException') {
          return false;
        }
        throw err;
      }))
  ).then((res) => res.filter((fn) => fn !== false));

  const appendLogSubscriptionInfo = (fns) => Promise.all(
    fns.map((fn) => aws
      .call('CloudWatchLogs:describeSubscriptionFilters', { logGroupName: logGroupName(fn) })
      .then((r) => ({
        ...r,
        ...fn
      }))
      .catch((err) => {
        if (err.code === 'ResourceNotFoundException') {
          return false;
        }
        throw err;
      }))
  ).then((res) => res.filter((fn) => fn !== false));

  const setCloudWatchRetention = (fn, retentionInDays) => aws
    .call('CloudWatchLogs:putRetentionPolicy', {
      logGroupName: logGroupName(fn),
      retentionInDays
    });

  const subscribeCloudWatchLogGroup = (monitor, producer) => aws
    .call('CloudWatchLogs:putSubscriptionFilter', {
      destinationArn: monitor.FunctionARN,
      filterName: 'NoneFilter',
      filterPattern: '',
      logGroupName: logGroupName(producer)
    });

  return {
    getAllFunctions,
    appendLogRetentionInfo,
    appendLogSubscriptionInfo,
    setCloudWatchRetention,
    subscribeCloudWatchLogGroup
  };
};
